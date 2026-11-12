import type { CookieJar } from 'tough-cookie';
import type { Currency, MarketplaceInfo, ObservationStatus, Offer, StoreId } from '@price-tracker/shared';

export interface PageResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  body: string;
  /** HTTP requests made, redirects included. */
  requestCount: number;
  durationMs: number;
  /** Headers of the final response, lower-case names. */
  headers?: Record<string, string>;
}

export interface FetchOptions {
  marketplace: MarketplaceInfo;
  acceptLanguage: string;
  /** A signed-in store account: its cookies, sent with the user agent of the browser that signed in. */
  session?: { jar: CookieJar; userAgent: string };
}

/** Fetches one page. Injected so tests can serve saved pages instead of calling the store. */
export type PageFetcher = (url: string, options: FetchOptions) => Promise<PageResponse>;

/** What one check of one listing found, before the guard and price conversion are applied. */
export interface CheckOutcome {
  status: ObservationStatus;
  /** The product ID the page itself reports (e.g. the ASIN), to spot redirects to another product. */
  pageExternalId: string | null;
  title: string | null;
  variantLabel: string | null;
  currency: Currency | null;
  price: number | null;
  /** false when the page shows the price without VAT; null when it doesn't say. */
  priceIncludesVat: boolean | null;
  shipping: number | null;
  inStock: boolean | null;
  availabilityText: string | null;
  deliveryLocation: string | null;
  deliveryLocationSource: 'ip' | 'account' | null;
  deliveryText: string | null;
  seller: string | null;
  shipsFrom: string | null;
  offers: Offer[];
  error: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  requestCount: number;
  raw: Record<string, unknown>;
}

export interface ListingTarget {
  marketplace: MarketplaceInfo;
  externalId: string;
  url: string;
  /** The listing's version check terms. On a page that sells several versions, they pick the version. */
  guardInclude?: string[];
  guardExclude?: string[];
}

/** What checking a listing needs: built-in adapters and the generic one for custom stores. */
export interface CheckAdapter {
  normalizeExternalId(raw: string): string | null;
  canonicalUrl(marketplace: MarketplaceInfo, externalId: string): string;
  check(target: ListingTarget, fetchPage: PageFetcher): Promise<CheckOutcome>;
}

/** A built-in store's adapter, which also recognises the store's URLs on its own. */
export interface StoreAdapter extends CheckAdapter {
  store: StoreId;
  /** Recognises one of this store's product URLs, without making any request. */
  parseUrl(url: URL): { marketplace: MarketplaceInfo; externalId: string } | null;
}

export function emptyOutcome(status: CheckOutcome['status'], error: string | null = null): CheckOutcome {
  return {
    status,
    pageExternalId: null,
    title: null,
    variantLabel: null,
    currency: null,
    price: null,
    priceIncludesVat: null,
    shipping: null,
    inStock: null,
    availabilityText: null,
    deliveryLocation: null,
    deliveryLocationSource: null,
    deliveryText: null,
    seller: null,
    shipsFrom: null,
    offers: [],
    error,
    httpStatus: null,
    durationMs: null,
    requestCount: 0,
    raw: {},
  };
}
