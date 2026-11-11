import { MARKETPLACES } from '@price-tracker/shared';
import type { MarketplaceInfo } from '@price-tracker/shared';
import { emptyOutcome } from '../types.ts';
import type { CheckOutcome, ListingTarget, PageFetcher, StoreAdapter } from '../types.ts';
import { countryName, parseAmazonPage } from './parse.ts';

const ASIN = /^[A-Z0-9]{10}$/;
// /dp/ASIN, /gp/product/ASIN, /gp/aw/d/ASIN (mobile), /exec/obidos/asin/ASIN, /o/ASIN
const ASIN_IN_PATH = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|o)\/([A-Za-z0-9]{10})(?:\/|$)/;
// English where the marketplace offers it, so availability and delivery texts read the same everywhere
const ACCEPT_LANGUAGE = 'en-GB,en;q=0.9';

function normalizeAsin(raw: string): string | null {
  const asin = raw.trim().toUpperCase();
  return ASIN.test(asin) ? asin : null;
}

function parseUrl(url: URL): { marketplace: MarketplaceInfo; externalId: string } | null {
  const host = url.hostname.toLowerCase().replace(/^(www|smile|m)\./, '');
  const marketplace = MARKETPLACES.find((m) => m.store === 'amazon' && m.id === host);
  if (!marketplace) return null;
  const asin = url.pathname.match(ASIN_IN_PATH)?.[1];
  return asin ? { marketplace, externalId: asin.toUpperCase() } : null;
}

const canonicalUrl = (marketplace: MarketplaceInfo, asin: string) => `https://${marketplace.host}/dp/${asin}`;

async function check(target: ListingTarget, fetchPage: PageFetcher): Promise<CheckOutcome> {
  const res = await fetchPage(target.url, { marketplace: target.marketplace, acceptLanguage: ACCEPT_LANGUAGE });
  const base = { httpStatus: res.status, durationMs: res.durationMs, requestCount: res.requestCount };
  const page = parseAmazonPage(res.body, target.marketplace);

  if (page.kind === 'captcha') return { ...emptyOutcome('captcha', 'Amazon showed a captcha instead of the page'), ...base };
  if (res.status === 404) return { ...emptyOutcome('not_found', 'Amazon says this page does not exist'), ...base };
  if ([403, 429, 503].includes(res.status)) return { ...emptyOutcome('blocked', `Amazon refused the request (HTTP ${res.status})`), ...base };
  if (res.status !== 200) return { ...emptyOutcome('error', `Unexpected HTTP ${res.status}`), ...base };
  if (page.kind !== 'product') return { ...emptyOutcome('error', 'The page is not a product page'), ...base, raw: { finalUrl: res.url } };

  let deliveryLocation: string | null = null;
  let deliveryLocationSource: CheckOutcome['deliveryLocationSource'] = null;
  if (page.signedIn && page.deliverToText) {
    // Signed in: the account's own address, e.g. "Lisbon 1000-001"
    deliveryLocation = page.deliverToText;
    deliveryLocationSource = 'account';
  } else if (page.deliveryCountry) {
    const name = countryName(page.deliveryCountry) ?? page.deliveryCountry;
    if (page.deliveryLocationShown) {
      deliveryLocation = name;
      deliveryLocationSource = 'ip'; // signed-out checks: Amazon guessed it from the IP
    } else {
      deliveryLocation = `${name} (Amazon's default; no location set)`;
    }
  }

  const status: CheckOutcome['status'] = page.price !== null ? 'ok' : page.inStock === false ? 'unavailable' : 'error';
  return {
    ...base,
    status,
    pageExternalId: page.asin,
    title: page.title,
    variantLabel: page.variantLabel,
    currency: page.currency,
    price: page.price,
    priceIncludesVat: page.priceIncludesVat,
    shipping: page.price !== null ? page.shipping : null,
    inStock: page.inStock,
    availabilityText: page.availabilityText,
    deliveryLocation,
    deliveryLocationSource,
    deliveryText: page.deliveryText,
    seller: page.seller,
    shipsFrom: page.shipsFrom,
    offers: [],
    error: status === 'error' ? 'No price found on the page' : null,
    raw: {
      finalUrl: res.url,
      deliveryCountry: page.deliveryCountry,
      deliveryZip: page.deliveryZip,
      deliverToText: page.deliverToText,
      signedIn: page.signedIn,
    },
  };
}

export const amazonAdapter: StoreAdapter = { store: 'amazon', parseUrl, normalizeExternalId: normalizeAsin, canonicalUrl, check };

/**
 * Amazon Business: the same pages, read the same way, but always with a business account's sign-in (the
 * check runner sees to that) and often priced without VAT. Amazon URLs are recognised as Amazon; business
 * listings are added next to Amazon ones for the same ASIN.
 */
export const amazonBusinessAdapter: StoreAdapter = { ...amazonAdapter, store: 'amazon-business', parseUrl: () => null };
