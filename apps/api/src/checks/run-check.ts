// One check of one listing: fetch the page, then record what it found: apply the variant guard, store the
// observation, pause the store after a captcha or block, and fire the product's alert rules.
import { and, desc, eq, gt } from 'drizzle-orm';
import type { AlertType } from '@price-tracker/shared';
import { evaluateAlerts } from '../alerts/evaluate.ts';
import type { CatalogService } from '../catalog.ts';
import type { Db } from '../db/client.ts';
import { alertEvents, alertRules, listings, observations, products, storeState } from '../db/schema.ts';
import { log } from '../log.ts';
import { describeBest, formatEur } from '../notify/format.ts';
import type { Notify } from '../notify/index.ts';
import { loadFxRates, toEur } from '../pricing/fx.ts';
import { round2 } from '../pricing/money.ts';
import { standardVatRate, withStandardVat } from '../pricing/vat.ts';
import { adapterFor } from '../stores/registry.ts';
import { emptyOutcome } from '../stores/types.ts';
import type { StoreSessions } from '../stores/sessions.ts';
import type { CheckOutcome, PageFetcher } from '../stores/types.ts';
import { DEFINITIVE_STATUSES, productPriceState } from '../views/products.ts';
import type { PriceState } from '../views/products.ts';
import { guardFailures } from './guard.ts';

export interface CheckDeps {
  db: Db;
  catalog: CatalogService;
  fetchPage: PageFetcher;
  notify: Notify;
  /** Signed-in store accounts: checks of their marketplaces use them. */
  sessions: StoreSessions;
  now?: () => Date;
}

export interface CheckRunner {
  /** Fetches the listing's page and records the result. */
  runCheck(listingId: number): Promise<void>;
  /** Records a result fetched elsewhere (a store preview) as the listing's check at that time. */
  recordOutcome(listingId: number, outcome: CheckOutcome, checkedAt: Date): Promise<void>;
}

const HOUR = 60 * 60 * 1000;
/** Pause after a captcha or block: 2 h, doubling with each one in a row, at most 48 h. */
export const pauseHours = (consecutiveBlocks: number): number => Math.min(2 * 2 ** (consecutiveBlocks - 1), 48);

/** Next check: the interval with ±10% jitter, so checks of many listings don't line up. */
export const nextCheckAfter = (from: Date, intervalMinutes: number, random = Math.random): Date =>
  new Date(from.getTime() + intervalMinutes * 60_000 * (0.9 + random() * 0.2));

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createCheckRunner({ db, catalog, fetchPage, notify, sessions, now = () => new Date() }: CheckDeps): CheckRunner {
  const load = async (listingId: number) => {
    const [row] = await db.select({ listing: listings, product: products }).from(listings).innerJoin(products, eq(listings.productId, products.id)).where(eq(listings.id, listingId));
    return row ?? null;
  };

  async function runCheck(listingId: number): Promise<void> {
    const row = await load(listingId);
    if (!row) return;
    const { listing } = row;
    const marketplace = catalog.marketplace(listing.marketplace);
    const adapter = adapterFor(listing.store, catalog.get());

    // Signed in to this marketplace? The check sends that account's cookies
    const info = catalog.store(listing.store);
    const session = info?.canSignIn ? await sessions.active(listing.store, listing.marketplace) : null;
    const fetchFor: PageFetcher = session
      ? (url, options) => fetchPage(url, { ...options, session: { jar: session.jar, userAgent: session.userAgent } })
      : fetchPage;

    let outcome: CheckOutcome;
    if (!marketplace || !adapter) {
      outcome = emptyOutcome('error', 'This store is not supported (any more)');
    } else if (info?.requiresSignIn && !session) {
      // Its prices are your account's (Amazon Business): without a sign-in there's nothing to check
      outcome = emptyOutcome('signed_out', `Sign in to ${marketplace.label} on the Stores page: its prices need your account`);
    } else {
      try {
        outcome = await adapter.check({ marketplace, externalId: listing.externalId, url: listing.url }, fetchFor);
      } catch (err) {
        outcome = { ...emptyOutcome('error', errorMessage(err)), requestCount: 1 };
      }
    }

    const pageSignedIn = (outcome.raw as { signedIn?: boolean | null }).signedIn;
    // A page read without the account (the sign-in just lapsed) isn't this store's price
    if (info?.requiresSignIn && session && pageSignedIn !== true && (outcome.status === 'ok' || outcome.status === 'unavailable')) {
      outcome = { ...outcome, status: 'signed_out', error: `${marketplace?.label ?? listing.marketplace} no longer accepts your sign-in; sign in again on the Stores page` };
    }
    await record(row, outcome, now(), !!session && pageSignedIn === true);
    if (!session) return;
    if (pageSignedIn === false) {
      // The store no longer accepts the sign-in: carry on without it, and say so once
      if (await session.expire()) {
        const label = catalog.marketplace(listing.marketplace)?.label ?? listing.marketplace;
        log.warn('store sign-in expired', { marketplace: listing.marketplace });
        await notify({
          title: `${label}: signed out`,
          message: `A check found your ${label} sign-in no longer valid. Checks continue without your account (delivery based on the server's IP) until you sign in again on the Stores page.`,
          priority: 6,
        });
      }
    } else if (pageSignedIn === true) {
      await session.persist(); // keep the cookies the store renewed
    }
  }

  async function recordOutcome(listingId: number, outcome: CheckOutcome, checkedAt: Date): Promise<void> {
    const row = await load(listingId);
    if (row) await record(row, outcome, checkedAt, false);
  }

  async function record({ listing, product }: NonNullable<Awaited<ReturnType<typeof load>>>, found: CheckOutcome, checkedAt: Date, signedIn: boolean) {
    let outcome = found;
    // Variant guard: is this page still the version the listing is for?
    if (outcome.status === 'ok' || outcome.status === 'unavailable') {
      const failures = guardFailures([outcome.title, outcome.variantLabel].filter(Boolean).join(' | '), listing.guardInclude, listing.guardExclude);
      if (failures.length) outcome = { ...outcome, status: 'variant_mismatch', error: `Not the expected version: ${failures.join(', ')}` };
    }
    if (outcome.pageExternalId && outcome.pageExternalId !== listing.externalId) {
      outcome = { ...outcome, raw: { ...outcome.raw, pageExternalId: outcome.pageExternalId } };
    }

    const rates = await loadFxRates(db);
    const deliveredPrice = outcome.price !== null && outcome.shipping !== null ? round2(outcome.price + outcome.shipping) : null;
    const headlinePrice = deliveredPrice ?? outcome.price;
    // Shown without VAT (Amazon Business): compare it with VAT added, at the delivery country's standard rate
    let comparable = headlinePrice;
    if (outcome.priceIncludesVat === false && headlinePrice !== null) {
      const country = (outcome.raw.deliveryCountry as string | null | undefined) ?? catalog.marketplace(listing.marketplace)?.country;
      comparable = withStandardVat(headlinePrice, country);
      outcome = { ...outcome, raw: { ...outcome.raw, vatAddedForComparison: standardVatRate(country), vatCountry: country ?? null } };
    }
    const headlineEur = toEur(comparable, outcome.currency, rates);

    const before = await productPriceState(db, product);
    await db.insert(observations).values({
      listingId: listing.id,
      store: listing.store,
      marketplace: listing.marketplace,
      checkedAt,
      status: outcome.status,
      signedIn,
      title: outcome.title,
      variantLabel: outcome.variantLabel,
      currency: outcome.currency,
      price: outcome.price,
      priceIncludesVat: outcome.priceIncludesVat,
      shipping: outcome.shipping,
      deliveredPrice,
      headlinePrice,
      headlineEur,
      inStock: outcome.inStock,
      availabilityText: outcome.availabilityText,
      deliveryLocation: outcome.deliveryLocation,
      deliveryLocationSource: outcome.deliveryLocationSource,
      deliveryText: outcome.deliveryText,
      seller: outcome.seller,
      shipsFrom: outcome.shipsFrom,
      offers: outcome.offers,
      error: outcome.error,
      httpStatus: outcome.httpStatus,
      durationMs: outcome.durationMs,
      requestCount: outcome.requestCount,
      raw: outcome.raw,
    });
    await db
      .update(listings)
      .set({ lastCheckedAt: checkedAt, nextCheckAt: nextCheckAfter(checkedAt, listing.intervalMinutes) })
      .where(eq(listings.id, listing.id));
    log.info('checked', {
      listing: listing.id,
      marketplace: listing.marketplace,
      status: outcome.status,
      price: headlinePrice ?? undefined,
      currency: outcome.currency ?? undefined,
      ms: outcome.durationMs ?? undefined,
      error: outcome.error ?? undefined,
    });

    const group = catalog.store(listing.store)?.rateGroup;
    if (group) await updateStoreState(group, listing.marketplace, outcome.status, checkedAt);

    const after = await productPriceState(db, product);
    await fireAlerts(product, before, after);
  }

  async function updateStoreState(group: string, marketplace: string, status: CheckOutcome['status'], at: Date) {
    if (status === 'captcha' || status === 'blocked') {
      const [state] = await db.select().from(storeState).where(eq(storeState.rateGroup, group));
      const blocks = (state?.consecutiveBlocks ?? 0) + 1;
      const hours = pauseHours(blocks);
      const pausedUntil = new Date(at.getTime() + hours * HOUR);
      const reason = `${marketplace} ${status === 'captcha' ? 'showed a captcha' : 'refused a request'}`;
      await db
        .insert(storeState)
        .values({ rateGroup: group, pausedUntil, pauseReason: reason, consecutiveBlocks: blocks, updatedAt: at })
        .onConflictDoUpdate({ target: storeState.rateGroup, set: { pausedUntil, pauseReason: reason, consecutiveBlocks: blocks, updatedAt: at } });
      log.warn('store paused', { group, hours, reason });
      const until = pausedUntil.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      await notify({
        title: `${catalog.rateGroup(group)?.label ?? group}: checks paused`,
        message: `${reason}. Checks are paused for ${hours} h, until ${until}. ${
          blocks > 1 ? `That's ${blocks} blocks in a row. ` : ''
        }Checking less often lowers the chance of the IP being blocked or the account banned.`,
        priority: 7,
      });
    } else if (DEFINITIVE_STATUSES.includes(status)) {
      await db
        .update(storeState)
        .set({ consecutiveBlocks: 0, updatedAt: at })
        .where(and(eq(storeState.rateGroup, group), gt(storeState.consecutiveBlocks, 0)));
    }
  }

  async function fireAlerts(product: typeof products.$inferSelect, before: PriceState, after: PriceState) {
    const rules = await db.select().from(alertRules).where(and(eq(alertRules.productId, product.id), eq(alertRules.enabled, true)));
    if (!rules.length) return;

    // The best listing's URL and shipping, for the message
    let bestUrl: string | null = null;
    let bestShipping: number | null = null;
    if (after.best) {
      const [l] = await db.select({ url: listings.url }).from(listings).where(eq(listings.id, after.best.listingId));
      bestUrl = l?.url ?? null;
      const [o] = await db
        .select({ shipping: observations.shipping })
        .from(observations)
        .where(and(eq(observations.listingId, after.best.listingId), eq(observations.status, 'ok')))
        .orderBy(desc(observations.checkedAt))
        .limit(1);
      bestShipping = o?.shipping ?? null;
    }

    const evaluation = evaluateAlerts(
      product.name,
      rules.map((r) => ({ id: r.id, type: r.type as AlertType, threshold: r.threshold, enabled: r.enabled, referencePrice: r.referencePrice })),
      before,
      after,
      (best) => describeBest(catalog.get(), best, bestShipping, bestUrl),
      formatEur,
    );
    for (const [ruleId, referencePrice] of evaluation.references) {
      await db.update(alertRules).set({ referencePrice }).where(eq(alertRules.id, ruleId));
    }
    for (const t of evaluation.triggers) {
      const delivered = await notify({ title: t.title, message: t.message, priority: t.priority, url: bestUrl ?? undefined });
      await db.insert(alertEvents).values({ ruleId: t.ruleId, productId: product.id, title: t.title, message: t.message, delivered });
      await db.update(alertRules).set({ lastTriggeredAt: now() }).where(eq(alertRules.id, t.ruleId));
      log.info('alert', { product: product.id, type: t.type, delivered });
    }
  }

  return { runCheck, recordOutcome };
}
