// Custom stores: any shop whose product pages publish schema.org product data. One request per check.
import { guardFailures, isCurrency } from '@price-tracker/shared';
import type { MarketplaceInfo } from '@price-tracker/shared';
import { formatMoney } from '../../notify/format.ts';
import { detectProtection } from '../protection.ts';
import { emptyOutcome } from '../types.ts';
import type { CheckAdapter, CheckOutcome, ListingTarget, PageFetcher } from '../types.ts';
import { parseShopPage, readAvailability, readSelector } from './parse.ts';
import type { ShopPage, ShopVariant } from './parse.ts';

// Analytics and ad parameters: they don't change the page, so they're dropped from the listing's address
const TRACKING_PARAM = /^(utm_.+|gclid|gclsrc|dclid|fbclid|msclkid|yclid|gad_source|gbraid|wbraid|srsltid|_ga|_gl|mc_cid|mc_eid|ref|ref_|tag|affiliate|aff_id|source|campaign)$/i;

/** The part of a product URL that identifies the page: path plus meaningful query parameters. */
export function pageRef(url: URL): string {
  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (!TRACKING_PARAM.test(k)) params.append(k, v);
  const query = params.toString();
  return (url.pathname || '/') + (query ? `?${query}` : '');
}

const LOCALES: Record<string, string> = { pt: 'pt-PT', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', nl: 'nl-NL' };
/** The shop's own language for its country domain ("PT" -> "pt-PT"), else British English. */
export const localeFor = (country: string): string => LOCALES[country.toLowerCase()] ?? 'en-GB';
/** Accept-Language for the shop's country, so pages come back as a visitor there sees them. */
export const acceptLanguageFor = (marketplace: MarketplaceInfo): string => {
  const locale = localeFor(marketplace.country);
  return locale === 'en-GB' ? 'en-GB,en;q=0.9' : `${locale},${locale.split('-')[0]};q=0.9,en;q=0.8`;
};

/** Host, path and the query parameters that pick the page, in a fixed order: to tell whether two links are the same version. */
function versionKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.searchParams.sort();
    return url.hostname.replace(/^www\./, '').toLowerCase() + pageRef(url).replace(/\/+(?=\?|$)/, '');
  } catch {
    return null;
  }
}

/** The versions' labels without the part they all share ("Intel Core Ultra 5 125H / 32GB RAM + 1TB SSD" -> "32GB RAM + 1TB SSD"). */
function shortLabels(variants: ShopVariant[]): string[] {
  const parts = variants.map((v) => v.label.split(' / '));
  let shared = 0;
  while (parts.every((p) => p.length > shared + 1 && p[shared] === parts[0]![shared])) shared++;
  return parts.map((p) => p.slice(shared).join(' / '));
}

function describeVersions(variants: ShopVariant[]): string {
  const labels = shortLabels(variants);
  return variants
    .map((v, i) => {
      const price = v.offer.price !== null ? ` ${formatMoney(v.offer.price, v.offer.currency ?? 'EUR')}` : '';
      const stock = readAvailability(v.offer.availability).inStock === false ? ' (out of stock)' : '';
      return `${labels[i]}${price}${stock}`;
    })
    .join('; ');
}

/**
 * Which of the page's versions the listing tracks: the one its link points at (?variant=…), else the only
 * one its version check terms fit, else (no terms) the page's default, the first in stock. A string when
 * the terms fit none or several: the check reports that instead of a price.
 */
function chooseVariant(page: ShopPage, target: ListingTarget, pageUrl: string): ShopVariant | string | null {
  const { variants } = page;
  if (!variants.length) return null;
  // Only a link with a query picks a version: some shops give the default version the bare page address
  const wanted = [target.url, pageUrl].filter((u) => u.includes('?')).map(versionKey).filter((k): k is string => !!k);
  const linked = wanted.length ? variants.find((v) => v.url && wanted.includes(versionKey(v.url) ?? '')) : undefined;
  if (linked) return linked;
  const include = target.guardInclude ?? [];
  const exclude = target.guardExclude ?? [];
  if (include.length || exclude.length) {
    const fits = variants.filter((v) => guardFailures(`${page.title ?? ''} | ${v.label}`, include, exclude).length === 0);
    if (fits.length === 1) return fits[0]!;
    return fits.length === 0
      ? `None of the page's ${variants.length} versions fits the version check terms. The page sells: ${describeVersions(variants)}`
      : `${fits.length} of the page's versions fit the version check terms: ${describeVersions(fits)}. Add a term only one of them has.`;
  }
  const priced = variants.filter((v) => v.offer.price !== null);
  return priced.find((v) => readAvailability(v.offer.availability).inStock !== false) ?? priced[0] ?? variants[0]!;
}

async function check(target: ListingTarget, fetchPage: PageFetcher): Promise<CheckOutcome> {
  const res = await fetchPage(target.url, { marketplace: target.marketplace, acceptLanguage: acceptLanguageFor(target.marketplace) });
  const base = { httpStatus: res.status, durationMs: res.durationMs, requestCount: res.requestCount };

  const protection = detectProtection(res.status, res.headers ?? {}, res.body);
  if (protection) return { ...emptyOutcome('blocked', `The shop answered with a ${protection} instead of the page`), ...base, raw: { protection } };
  if (res.status === 404 || res.status === 410) return { ...emptyOutcome('not_found', 'The shop says this page does not exist'), ...base };
  if ([403, 429, 503].includes(res.status)) return { ...emptyOutcome('blocked', `The shop refused the request (HTTP ${res.status})`), ...base };
  if (res.status !== 200) return { ...emptyOutcome('error', `Unexpected HTTP ${res.status}`), ...base };

  const page = parseShopPage(res.body, res.url);
  const raw: Record<string, unknown> = {
    finalUrl: res.url,
    dataSource: page.dataSource,
    gtin: page.gtin,
    sku: page.sku,
    siteName: page.siteName,
    canonicalUrl: page.canonicalUrl,
    condition: page.offer?.condition ?? null,
  };

  // A picked price element wins over the page's product data
  const selector = target.marketplace.priceSelector;
  if (selector) {
    const picked = readSelector(res.body, selector);
    raw.selectorText = picked.text;
    if (picked.price === null) {
      return {
        ...emptyOutcome('error', picked.found ? `The price element has no price in it ("${picked.text ?? ''}")` : "The price element wasn't found on the page. The shop may have changed its layout: pick the price again."),
        ...base,
        title: page.title,
        raw,
      };
    }
    const currency = page.offer?.currency && isCurrency(page.offer.currency.toUpperCase()) ? (page.offer.currency.toUpperCase() as CheckOutcome['currency']) : target.marketplace.currency;
    return {
      ...emptyOutcome(page.inStock === false ? 'unavailable' : 'ok'),
      ...base,
      title: page.title,
      currency,
      price: picked.price,
      inStock: page.inStock,
      availabilityText: page.availabilityText,
      raw: { ...raw, dataSource: 'selector' },
    };
  }

  if (!page.dataSource) {
    return { ...emptyOutcome('error', 'No product data on this page (the shop doesn\'t publish schema.org product data)'), ...base, title: page.title, raw };
  }

  // Several versions on one page: track the chosen one's price
  const variant = chooseVariant(page, target, res.url);
  if (page.variants.length) {
    raw.variants = page.variants.map((v) => ({ label: v.label, url: v.url, price: v.offer.price, currency: v.offer.currency, inStock: readAvailability(v.offer.availability).inStock }));
  }
  if (typeof variant === 'string') return { ...emptyOutcome('variant_mismatch', variant), ...base, title: page.title, raw };
  if (variant) raw.variant = variant.url;
  const offer = variant?.offer ?? page.offer;
  const availability = variant ? readAvailability(variant.offer.availability) : { inStock: page.inStock, text: page.availabilityText };
  const price = offer?.price ?? null;
  const status: CheckOutcome['status'] = availability.inStock === false ? 'unavailable' : price !== null ? 'ok' : 'error';
  const currency = offer?.currency && isCurrency(offer.currency.toUpperCase()) ? (offer.currency.toUpperCase() as CheckOutcome['currency']) : price !== null ? target.marketplace.currency : null;
  return {
    ...base,
    status,
    pageExternalId: null,
    title: page.title,
    variantLabel: variant?.label ?? null,
    currency,
    price,
    priceIncludesVat: null,
    shipping: offer?.shipping ?? null,
    inStock: availability.inStock,
    availabilityText: availability.text,
    deliveryLocation: null,
    deliveryLocationSource: null,
    deliveryText: null,
    seller: offer?.seller ?? null,
    shipsFrom: null,
    // Other sellers' offers for this product; the page's other versions are different products
    offers: (variant ? [] : page.offers)
      .filter((o) => o !== offer && o.price !== null)
      .map((o) => ({ seller: o.seller, condition: o.condition, price: o.price!, shipping: o.shipping, currency: currency ?? target.marketplace.currency })),
    error: status === 'error' ? 'The product data has no price' : null,
    raw,
  };
}

export const genericAdapter: CheckAdapter = {
  normalizeExternalId: (raw) => (raw.trim().startsWith('/') ? raw.trim() : null),
  canonicalUrl: (marketplace, ref) => `https://${marketplace.host}${ref}`,
  check,
};
