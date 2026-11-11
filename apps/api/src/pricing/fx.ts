import type { Currency } from '@price-tracker/shared';
import type { Db } from '../db/client.ts';
import { fxRates } from '../db/schema.ts';
import { log } from '../log.ts';
import { round2 } from './money.ts';

const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** Parses the ECB daily reference rates XML into { date, rates: { SEK: 11.2, ... } }. */
export function parseEcbXml(xml: string): { date: string; rates: Record<string, number> } | null {
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  if (!date) return null;
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]!] = Number(m[2]);
  return { date, rates };
}

/** Fetches today's ECB rates once a day at most. Only called when some listing isn't priced in EUR. */
export async function refreshFxRates(db: Db, now = new Date()): Promise<void> {
  const existing = await db.select().from(fxRates);
  const newest = existing.reduce<Date | null>((acc, r) => (!acc || r.fetchedAt > acc ? r.fetchedAt : acc), null);
  if (newest && now.getTime() - newest.getTime() < 20 * 60 * 60 * 1000) return;
  try {
    const res = await fetch(ECB_DAILY, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseEcbXml(await res.text());
    if (!parsed) throw new Error('unexpected ECB response');
    for (const [currency, perEur] of Object.entries(parsed.rates)) {
      await db
        .insert(fxRates)
        .values({ currency, perEur, rateDate: parsed.date, fetchedAt: now })
        .onConflictDoUpdate({ target: fxRates.currency, set: { perEur, rateDate: parsed.date, fetchedAt: now } });
    }
    log.info('fx rates updated', { date: parsed.date, currencies: Object.keys(parsed.rates).length });
  } catch (err) {
    log.warn('fx rates refresh failed', { error: err });
  }
}

export async function loadFxRates(db: Db): Promise<Map<string, number>> {
  const rows = await db.select().from(fxRates);
  return new Map(rows.map((r) => [r.currency, r.perEur]));
}

/** Converts to EUR; null when the rate isn't known yet. */
export function toEur(amount: number | null, currency: Currency | string | null, rates: Map<string, number>): number | null {
  if (amount === null || !currency) return null;
  if (currency === 'EUR') return amount;
  const perEur = rates.get(currency);
  return perEur ? round2(amount / perEur) : null;
}
