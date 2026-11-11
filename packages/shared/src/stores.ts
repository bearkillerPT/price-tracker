// Stores, marketplaces and the limits that keep request volume low. Shared by the API and the web UI.
//
// Built-in stores (Amazon) have their own code. Custom stores are added from the UI and stored in the
// database; each is one domain (its ID, e.g. "fnac.pt"), one marketplace and its own rate group, and is
// read from the product data the page publishes (schema.org). The API merges both into a Catalog
// (GET /api/catalog); code that needs a store's details looks it up there.
//
// PcComponentes is left out for now: its Cloudflare check blocks unattended clients, so the old Python script
// on the Pi keeps tracking it. See DESIGN.md.

export const BUILT_IN_STORE_IDS = ['amazon', 'amazon-business'] as const;
export type BuiltInStoreId = (typeof BUILT_IN_STORE_IDS)[number];
/** A built-in store's ID, or a custom store's: its domain without "www.", e.g. "fnac.pt". */
export type StoreId = string;
/** Stores in one rate group share a request budget and are paused together (same company, same IP). */
export type RateGroupId = string;

/** Currencies the ECB publishes rates for, so prices in them can be compared in EUR. */
export const CURRENCIES = ['EUR', 'SEK', 'PLN', 'GBP', 'CHF', 'CZK', 'DKK', 'HUF', 'NOK', 'RON', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const isCurrency = (c: unknown): c is Currency => typeof c === 'string' && (CURRENCIES as readonly string[]).includes(c);

export const CONDITIONS = ['new', 'as_new', 'refurbished', 'used'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  new: 'New',
  as_new: 'As new',
  refurbished: 'Refurbished',
  used: 'Used',
};

/** Checks can't run more often than this, per listing. */
export const MIN_INTERVAL_MINUTES = 30;

export interface StoreInfo {
  id: StoreId;
  label: string;
  rateGroup: RateGroupId;
  /** False until the store's adapter exists; the UI lists it but can't add listings for it. */
  implemented: boolean;
  requiresSignIn: boolean;
  defaultIntervalMinutes: number;
  /** What a listing's external ID is called in this store, e.g. "ASIN". */
  externalIdLabel: string;
  /** Added from the UI (read from schema.org product data) rather than built in. */
  custom: boolean;
  /** You can sign in to it (in the live browser), so checks see your account's prices and address. */
  canSignIn: boolean;
}

export const STORES: Record<BuiltInStoreId, StoreInfo> = {
  amazon: {
    id: 'amazon',
    label: 'Amazon',
    rateGroup: 'amazon',
    implemented: true,
    requiresSignIn: false,
    defaultIntervalMinutes: 180,
    externalIdLabel: 'ASIN',
    custom: false,
    canSignIn: true,
  },
  'amazon-business': {
    id: 'amazon-business',
    label: 'Amazon Business',
    rateGroup: 'amazon',
    implemented: true,
    requiresSignIn: true,
    defaultIntervalMinutes: 180,
    externalIdLabel: 'ASIN',
    custom: false,
    canSignIn: true,
  },
};

export interface RateGroupInfo {
  id: RateGroupId;
  label: string;
  stores: StoreId[];
  /** Planned requests per hour above which the UI warns, and above which it warns strongly. */
  warnPerHour: number;
  dangerPerHour: number;
}

export const RATE_GROUPS: Record<'amazon', RateGroupInfo> = {
  amazon: { id: 'amazon', label: 'Amazon and Amazon Business', stores: ['amazon', 'amazon-business'], warnPerHour: 20, dangerPerHour: 60 },
};

/** Defaults for custom stores: one shop, so a lower budget than Amazon's many marketplaces. */
export const CUSTOM_STORE_DEFAULTS = { defaultIntervalMinutes: 180, warnPerHour: 10, dangerPerHour: 30 } as const;

export const FETCH_METHODS = ['http', 'browser'] as const;
/** "http": one plain page load. "browser": load the page in Chromium, for prices the page's scripts add. */
export type FetchMethod = (typeof FETCH_METHODS)[number];

export interface MarketplaceInfo {
  /** Stable ID, also the store's domain without "www.", e.g. "amazon.de". */
  id: string;
  store: StoreId;
  /** Host name requests go to. */
  host: string;
  /** ISO 3166-1 alpha-2 country code, or "" when unknown. */
  country: string;
  label: string;
  currency: Currency;
  /** How checks load pages. Built-in stores: always "http". */
  fetchMethod?: FetchMethod;
  /** Custom stores: CSS selector of the price element, picked on a product page. Wins over the page's product data. */
  priceSelector?: string | null;
}

const amazon = (id: string, country: string, label: string, currency: Currency = 'EUR'): MarketplaceInfo => ({
  id,
  store: 'amazon',
  host: `www.${id}`,
  country,
  label,
  currency,
});

/**
 * Amazon Business uses the same sites as Amazon, signed in with a business account. Its marketplaces get
 * their own IDs ("business.amazon.de") so listings, sign-ins and labels stay apart from Amazon's.
 */
const business = (domain: string, country: string, label: string): MarketplaceInfo => ({
  id: `business.${domain}`,
  store: 'amazon-business',
  host: `www.${domain}`,
  country,
  label,
  currency: 'EUR',
});

export const MARKETPLACES: MarketplaceInfo[] = [
  amazon('amazon.de', 'DE', 'Amazon Germany'),
  amazon('amazon.fr', 'FR', 'Amazon France'),
  amazon('amazon.it', 'IT', 'Amazon Italy'),
  amazon('amazon.es', 'ES', 'Amazon Spain'),
  amazon('amazon.nl', 'NL', 'Amazon Netherlands'),
  amazon('amazon.com.be', 'BE', 'Amazon Belgium'),
  amazon('amazon.ie', 'IE', 'Amazon Ireland'),
  amazon('amazon.se', 'SE', 'Amazon Sweden', 'SEK'),
  amazon('amazon.pl', 'PL', 'Amazon Poland', 'PLN'),
  business('amazon.de', 'DE', 'Amazon Business Germany'),
  business('amazon.fr', 'FR', 'Amazon Business France'),
  business('amazon.it', 'IT', 'Amazon Business Italy'),
  business('amazon.es', 'ES', 'Amazon Business Spain'),
];

/** Stores whose listings share IDs (ASINs): one Amazon link can be tracked in either. */
export const storeFamily = (store: string): string[] => (store === 'amazon' || store === 'amazon-business' ? ['amazon', 'amazon-business'] : [store]);

/** Every store, marketplace and rate group: the built-in ones plus custom stores. */
export interface Catalog {
  stores: StoreInfo[];
  marketplaces: MarketplaceInfo[];
  rateGroups: RateGroupInfo[];
}

export const BUILT_IN_CATALOG: Catalog = {
  stores: Object.values(STORES),
  marketplaces: MARKETPLACES,
  rateGroups: Object.values(RATE_GROUPS),
};

export const storeIn = (catalog: Catalog, id: string): StoreInfo | undefined => catalog.stores.find((s) => s.id === id);
export const marketplaceIn = (catalog: Catalog, id: string): MarketplaceInfo | undefined => catalog.marketplaces.find((m) => m.id === id);
export const marketplacesOfStore = (catalog: Catalog, store: string): MarketplaceInfo[] => catalog.marketplaces.filter((m) => m.store === store);
export const rateGroupIn = (catalog: Catalog, id: string): RateGroupInfo | undefined => catalog.rateGroups.find((g) => g.id === id);

/** Requests per hour a listing adds to its rate group, from its check interval. */
export const requestsPerHour = (intervalMinutes: number): number => 60 / intervalMinutes;

/** "www.fnac.pt" -> "fnac.pt": a custom store's ID. */
export const storeIdFromHost = (host: string): string => host.toLowerCase().replace(/^www\./, '');
