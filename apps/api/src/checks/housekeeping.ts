// Every few minutes: refresh exchange rates when a non-EUR listing exists, send the daily summary at
// the configured hour, and drop expired login sessions.
import { and, eq, isNull, lt, ne, or } from 'drizzle-orm';
import { marketplaceIn } from '@price-tracker/shared';
import type { Catalog } from '@price-tracker/shared';
import type { Db } from '../db/client.ts';
import { appSessions, listings, settings } from '../db/schema.ts';
import { log } from '../log.ts';
import { formatEur, formatPrice, marketplaceLabel } from '../notify/format.ts';
import type { Notify } from '../notify/index.ts';
import { refreshFxRates } from '../pricing/fx.ts';
import { loadProductDetails } from '../views/products.ts';

export const serverTimeZone = (): string => process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Local date (YYYY-MM-DD) and hour in the given time zone. */
export function localDateHour(at: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export async function dailySummaryText(db: Db, catalog: Catalog): Promise<string | null> {
  const products = (await loadProductDetails(db)).filter((p) => !p.archived);
  if (!products.length) return null;
  return products
    .map((p) => {
      if (!p.best) return `• ${p.name}: no price yet`;
      const eur = p.best.currency !== 'EUR' && p.best.headlineEur !== null ? ` (about ${formatEur(p.best.headlineEur)})` : '';
      return `• ${p.name}: ${formatPrice(p.best)}${eur} at ${marketplaceLabel(catalog, p.best.marketplace, p.best.store)}`;
    })
    .join('\n');
}

export async function housekeeping(db: Db, catalog: Catalog, notify: Notify, at = new Date()): Promise<void> {
  await db.delete(appSessions).where(lt(appSessions.expiresAt, at));

  const marketplaces = await db.selectDistinct({ marketplace: listings.marketplace }).from(listings).where(eq(listings.enabled, true));
  if (marketplaces.some((m) => (marketplaceIn(catalog, m.marketplace)?.currency ?? 'EUR') !== 'EUR')) await refreshFxRates(db, at);

  const [s] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!s?.dailySummaryEnabled) return;
  const { date, hour } = localDateHour(at, serverTimeZone());
  if (hour !== s.dailySummaryHour || s.lastDailySummaryDate === date) return;
  // Claim the day first, so a slow send can't make the next run send it twice
  const claimed = await db
    .update(settings)
    .set({ lastDailySummaryDate: date })
    .where(and(eq(settings.id, 1), eq(settings.dailySummaryHour, hour), or(isNull(settings.lastDailySummaryDate), ne(settings.lastDailySummaryDate, date))))
    .returning({ id: settings.id });
  if (!claimed.length) return;
  const text = await dailySummaryText(db, catalog);
  if (text) await notify({ title: 'Prices today', message: text, priority: 4 });
  log.info('daily summary', { sent: !!text });
}

export function startHousekeeping(db: Db, catalog: () => Catalog, notify: Notify, everyMs = 5 * 60_000): () => void {
  const run = () => housekeeping(db, catalog(), notify).catch((err) => log.error('housekeeping failed', { error: err }));
  const first = setTimeout(run, 10_000);
  const timer = setInterval(run, everyMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
