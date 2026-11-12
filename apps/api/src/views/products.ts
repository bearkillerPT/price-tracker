// Builds the API's product views (and the product price state alerts compare) from database rows.
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type {
  AlertRule,
  AlertType,
  BestPrice,
  Condition,
  Currency,
  Listing,
  Observation,
  ObservationStatus,
  ProductDetail,
  ProductHistory,
  ProductSummary,
  StoreId,
} from '@price-tracker/shared';
import type { Db } from '../db/client.ts';
import { alertRules, listings, observations, products } from '../db/schema.ts';

export type ObservationRow = typeof observations.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type ProductRow = typeof products.$inferSelect;

/** Results that say something about the product itself, as opposed to the check failing. */
export const DEFINITIVE_STATUSES: ObservationStatus[] = ['ok', 'unavailable', 'variant_mismatch', 'not_found'];
/** Latest results that need the user's attention. */
export const ISSUE_STATUSES: ObservationStatus[] = ['variant_mismatch', 'not_found', 'captcha', 'blocked', 'signed_out', 'error'];

export interface PriceState {
  best: BestPrice | null;
  /** null while no listing has a definitive result yet. */
  anyInStock: boolean | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toObservation(r: ObservationRow): Observation {
  return {
    id: r.id,
    checkedAt: r.checkedAt.toISOString(),
    status: r.status as ObservationStatus,
    signedIn: r.signedIn,
    title: r.title,
    variantLabel: r.variantLabel,
    currency: r.currency as Currency | null,
    price: r.price,
    priceIncludesVat: r.priceIncludesVat,
    priceInclVat: typeof r.raw?.priceInclVat === 'number' ? r.raw.priceInclVat : null,
    shipping: r.shipping,
    deliveredPrice: r.deliveredPrice,
    headlinePrice: r.headlinePrice,
    headlineEur: r.headlineEur,
    inStock: r.inStock,
    availabilityText: r.availabilityText,
    deliveryLocation: r.deliveryLocation,
    deliveryLocationSource: r.deliveryLocationSource as Observation['deliveryLocationSource'],
    deliveryText: r.deliveryText,
    seller: r.seller,
    shipsFrom: r.shipsFrom,
    offers: r.offers,
    error: r.error,
  };
}

function toListing(l: ListingRow, latest: ObservationRow | undefined, lastOk: ObservationRow | undefined): Listing {
  return {
    id: l.id,
    productId: l.productId,
    store: l.store as StoreId,
    marketplace: l.marketplace,
    externalId: l.externalId,
    url: l.url,
    condition: l.condition as Condition,
    intervalMinutes: l.intervalMinutes,
    enabled: l.enabled,
    guardInclude: l.guardInclude,
    guardExclude: l.guardExclude,
    lastCheckedAt: iso(l.lastCheckedAt),
    nextCheckAt: l.enabled ? iso(l.nextCheckAt) : null,
    latest: latest ? toObservation(latest) : null,
    lastOk: lastOk ? toObservation(lastOk) : null,
  };
}

/**
 * The product's price: the cheapest headline price (compared in EUR) among enabled listings in an
 * accepted condition whose latest definitive result read a price. Failed checks (captcha, error...)
 * don't hide the last known price; "unavailable" or "variant_mismatch" do.
 */
export function computePriceState(
  acceptedConditions: string[],
  productListings: ListingRow[],
  definitive: Map<number, ObservationRow>,
): PriceState {
  let best: BestPrice | null = null;
  let bestRank = Infinity;
  let anyKnown = false;
  let anyInStock = false;
  for (const l of productListings) {
    if (!l.enabled || !acceptedConditions.includes(l.condition)) continue;
    const o = definitive.get(l.id);
    if (!o) continue;
    anyKnown = true;
    if (o.status !== 'ok' || o.headlinePrice === null || !o.currency) continue;
    if (o.inStock !== false) anyInStock = true;
    // Without an exchange rate a non-EUR price can't be compared; rank it last
    const rank = o.headlineEur ?? Number.MAX_SAFE_INTEGER;
    if (rank < bestRank) {
      bestRank = rank;
      best = {
        listingId: l.id,
        store: l.store as StoreId,
        marketplace: l.marketplace,
        condition: l.condition as Condition,
        headlinePrice: o.headlinePrice,
        currency: o.currency as Currency,
        headlineEur: o.headlineEur,
        priceIncludesVat: o.priceIncludesVat,
        checkedAt: o.checkedAt.toISOString(),
      };
    }
  }
  return { best, anyInStock: anyKnown ? anyInStock : null };
}

/** Latest observation per listing, optionally only among some statuses. */
export async function latestPerListing(db: Db, listingIds: number[], statuses?: ObservationStatus[]): Promise<Map<number, ObservationRow>> {
  if (!listingIds.length) return new Map();
  const rows = await db
    .selectDistinctOn([observations.listingId])
    .from(observations)
    .where(and(inArray(observations.listingId, listingIds), statuses ? inArray(observations.status, statuses) : undefined))
    .orderBy(observations.listingId, desc(observations.checkedAt), desc(observations.id));
  return new Map(rows.map((r) => [r.listingId, r]));
}

export async function productPriceState(db: Db, product: ProductRow): Promise<PriceState> {
  const rows = await db.select().from(listings).where(eq(listings.productId, product.id));
  const definitive = await latestPerListing(db, rows.map((l) => l.id), DEFINITIVE_STATUSES);
  return computePriceState(product.acceptedConditions, rows, definitive);
}

/** Full views of the given products, or of all products. */
export async function loadProductDetails(db: Db, ids?: number[]): Promise<ProductDetail[]> {
  const productRows = ids ? (ids.length ? await db.select().from(products).where(inArray(products.id, ids)) : []) : await db.select().from(products);
  if (!productRows.length) return [];
  const productIds = productRows.map((p) => p.id);
  const listingRows = await db.select().from(listings).where(inArray(listings.productId, productIds)).orderBy(listings.id);
  const listingIds = listingRows.map((l) => l.id);
  const [latest, lastOk, definitive, ruleRows] = await Promise.all([
    latestPerListing(db, listingIds),
    latestPerListing(db, listingIds, ['ok']),
    latestPerListing(db, listingIds, DEFINITIVE_STATUSES),
    db.select().from(alertRules).where(inArray(alertRules.productId, productIds)).orderBy(alertRules.id),
  ]);

  return productRows
    .map((p): ProductDetail => {
      const own = listingRows.filter((l) => l.productId === p.id);
      const { best } = computePriceState(p.acceptedConditions, own, definitive);
      const lastChecked = own.reduce<Date | null>((acc, l) => (l.lastCheckedAt && (!acc || l.lastCheckedAt > acc) ? l.lastCheckedAt : acc), null);
      return {
        id: p.id,
        name: p.name,
        ean: p.ean,
        notes: p.notes,
        acceptedConditions: p.acceptedConditions as Condition[],
        archived: p.archived,
        createdAt: p.createdAt.toISOString(),
        best,
        listingCount: own.length,
        issueCount: own.filter((l) => l.enabled && ISSUE_STATUSES.includes(latest.get(l.id)?.status as ObservationStatus)).length,
        lastCheckedAt: iso(lastChecked),
        listings: own.map((l) => toListing(l, latest.get(l.id), lastOk.get(l.id))),
        alertRules: ruleRows
          .filter((r) => r.productId === p.id)
          .map(
            (r): AlertRule => ({
              id: r.id,
              productId: r.productId,
              type: r.type as AlertType,
              threshold: r.threshold,
              enabled: r.enabled,
              lastTriggeredAt: iso(r.lastTriggeredAt),
            }),
          ),
      };
    })
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
}

export async function loadProductDetail(db: Db, id: number): Promise<ProductDetail | null> {
  return (await loadProductDetails(db, [id]))[0] ?? null;
}

export function toSummary({ listings: _listings, alertRules: _rules, ...summary }: ProductDetail): ProductSummary {
  return summary;
}

export async function loadHistory(db: Db, productId: number, days: number): Promise<ProductHistory> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const listingRows = await db.select().from(listings).where(eq(listings.productId, productId)).orderBy(listings.id);
  if (!listingRows.length) return { listings: [] };
  const rows = await db
    .select({
      listingId: observations.listingId,
      checkedAt: observations.checkedAt,
      status: observations.status,
      headlinePrice: observations.headlinePrice,
      headlineEur: observations.headlineEur,
      currency: observations.currency,
    })
    .from(observations)
    .where(and(inArray(observations.listingId, listingRows.map((l) => l.id)), gte(observations.checkedAt, since)))
    .orderBy(observations.checkedAt);
  return {
    listings: listingRows.map((l) => {
      const own = rows.filter((r) => r.listingId === l.id);
      return {
        listingId: l.id,
        store: l.store as StoreId,
        marketplace: l.marketplace,
        condition: l.condition as Condition,
        currency: (own.find((r) => r.currency)?.currency ?? null) as Currency | null,
        // Only checks that read a valid price carry one: a wrong-version page's price isn't this product's
        points: own.map((r) => ({
          t: r.checkedAt.toISOString(),
          status: r.status as ObservationStatus,
          headlinePrice: r.status === 'ok' ? r.headlinePrice : null,
          headlineEur: r.status === 'ok' ? r.headlineEur : null,
        })),
      };
    }),
  };
}
