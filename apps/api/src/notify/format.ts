import { marketplaceIn } from '@price-tracker/shared';
import type { BestPrice, Catalog } from '@price-tracker/shared';

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(amount);
}

export const formatEur = (amount: number): string => formatMoney(amount, 'EUR');

/** "Amazon Germany", "Amazon Business Germany", "Fnac". */
export function marketplaceLabel(catalog: Catalog, marketplace: string, _store?: string): string {
  return marketplaceIn(catalog, marketplace)?.label ?? marketplace;
}

/** "€958.22 at Amazon Germany (incl. €9.22 delivery)" plus the EUR value for other currencies. */
export function describeBest(catalog: Catalog, best: BestPrice, shipping: number | null, url: string | null): string {
  const parts = [`${formatMoney(best.headlinePrice, best.currency)} at ${marketplaceLabel(catalog, best.marketplace, best.store)}`];
  if (shipping) parts.push(` (incl. ${formatMoney(shipping, best.currency)} delivery)`);
  if (best.currency !== 'EUR' && best.headlineEur !== null) parts.push(`, about ${formatEur(best.headlineEur)}`);
  if (best.condition !== 'new') parts.push(` [${best.condition.replace('_', ' ')}]`);
  return parts.join('') + (url ? `\n${url}` : '');
}
