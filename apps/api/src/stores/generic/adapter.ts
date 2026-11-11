// Custom stores: any shop whose product pages publish schema.org product data. One request per check.
import { isCurrency } from '@price-tracker/shared';
import type { MarketplaceInfo } from '@price-tracker/shared';
import { detectProtection } from '../protection.ts';
import { emptyOutcome } from '../types.ts';
import type { CheckAdapter, CheckOutcome, ListingTarget, PageFetcher } from '../types.ts';
import { parseShopPage, readSelector } from './parse.ts';

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
  const offer = page.offer;
  const price = offer?.price ?? null;
  const status: CheckOutcome['status'] = page.inStock === false ? 'unavailable' : price !== null ? 'ok' : 'error';
  const currency = offer?.currency && isCurrency(offer.currency.toUpperCase()) ? (offer.currency.toUpperCase() as CheckOutcome['currency']) : price !== null ? target.marketplace.currency : null;
  return {
    ...base,
    status,
    pageExternalId: null,
    title: page.title,
    variantLabel: null,
    currency,
    price,
    priceIncludesVat: null,
    shipping: offer?.shipping ?? null,
    inStock: page.inStock,
    availabilityText: page.availabilityText,
    deliveryLocation: null,
    deliveryLocationSource: null,
    deliveryText: null,
    seller: offer?.seller ?? null,
    shipsFrom: null,
    offers: page.offers
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
