// The HTTP API between apps/api and apps/web: request bodies (zod schemas, validated by the API) and
// response shapes (plain types). Every route is under /api, takes and returns JSON, and answers
// errors as { error: string, details?: unknown }. Every route except /api/auth/* and /api/health
// answers 401 when there's no valid session.
//
//   GET    /api/health                         -> { ok: true }
//   GET    /api/auth/state                     -> AuthState
//   POST   /api/auth/setup        PasswordBody -> AuthState      (only while no account exists)
//   POST   /api/auth/login        PasswordBody -> AuthState
//   POST   /api/auth/logout                    -> AuthState
//   POST   /api/auth/password     ChangePasswordBody -> AuthState (ends every other login session)
//
//   GET    /api/products                       -> ProductSummary[]   (archived ones last)
//   POST   /api/products          ProductCreate -> ProductDetail
//   GET    /api/products/:id                   -> ProductDetail
//   PATCH  /api/products/:id      ProductUpdate -> ProductDetail
//   DELETE /api/products/:id                   -> { ok: true }
//   GET    /api/products/:id/history?days=30   -> ProductHistory
//
//   GET    /api/catalog                        -> Catalog          (built-in and custom stores)
//   POST   /api/custom-stores/preview StorePreviewBody -> StorePreview (ONE request to the shop)
//   POST   /api/custom-stores/test-selector SelectorTestBody -> SelectorTest (ONE request to the shop)
//   POST   /api/custom-stores  CustomStoreCreate -> Catalog
//   PATCH  /api/custom-stores/:id CustomStoreUpdate -> Catalog
//   DELETE /api/custom-stores/:id               -> Catalog         (only without listings)
//
//   POST   /api/listings/parse-url ParseUrlBody -> ParseUrlResult  (no request to the store)
//   POST   /api/products/:id/listings ListingCreate -> ProductDetail (one listing per marketplace)
//   PATCH  /api/listings/:id      ListingUpdate -> ProductDetail
//   DELETE /api/listings/:id                   -> ProductDetail
//   POST   /api/listings/:id/check             -> ProductDetail   (queues a check; it still waits its turn)
//
//   POST   /api/products/:id/alerts AlertRuleCreate -> ProductDetail
//   PATCH  /api/alerts/:id        AlertRuleUpdate -> ProductDetail
//   DELETE /api/alerts/:id                     -> ProductDetail
//
//   GET    /api/stores                         -> RateGroupStatus[]
//   POST   /api/stores/:group/resume           -> RateGroupStatus[]
//
//   GET    /api/notification-channels         -> NotificationChannel[]
//   POST   /api/notification-channels  NotificationChannelCreate -> NotificationChannel[]
//   PATCH  /api/notification-channels/:id NotificationChannelUpdate -> NotificationChannel[]
//   DELETE /api/notification-channels/:id      -> NotificationChannel[]
//   POST   /api/notification-channels/:id/test -> { ok: true }
//
//   POST   /api/browser/sessions LiveSessionCreate -> LiveSession  (opens Chromium on the server)
//   DELETE /api/browser/sessions/:id           -> { ok: true }
//   WS     /api/browser/live?id=<session id>   LiveClientMessage in, LiveServerMessage out
//
//   GET    /api/store-sessions                 -> StoreSessionStatus[] (every marketplace you can sign in to)
//   POST   /api/store-sessions/sign-in SignInStart -> LiveSession  (opens the store in the live browser)
//   POST   /api/store-sessions/save SignInSave -> SignInResult (keeps the sign-in, and finds the other
//                                                                 marketplaces Amazon signed you in to with it)
//   DELETE /api/store-sessions/:store/:marketplace -> StoreSessionStatus[] (forgets it; the store isn't signed out)
//
//   GET    /api/settings                       -> Settings
//   PATCH  /api/settings          SettingsUpdate -> Settings

import { z } from 'zod';
import { CONDITIONS, CURRENCIES, FETCH_METHODS, MIN_INTERVAL_MINUTES } from './stores.ts';
import type { Condition, Currency, FetchMethod, RateGroupId, StoreId } from './stores.ts';

// ---- Enums ----

export const OBSERVATION_STATUSES = [
  'ok', // price read
  'unavailable', // page read, but the product can't be bought right now
  'variant_mismatch', // the page isn't the version the listing's guard asks for
  'not_found', // the store says the page doesn't exist
  'captcha', // the store showed a captcha instead of the page
  'blocked', // the store refused the request (bot challenge, 403, 503)
  'signed_out', // a signed-in check found the session gone
  'error', // anything else: network error, unexpected page
] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const ALERT_TYPES = ['target_price', 'drop_percent', 'any_drop', 'back_in_stock'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  target_price: 'Price at or below a target',
  drop_percent: 'Price drops by at least a percentage',
  any_drop: 'Any price drop',
  back_in_stock: 'Back in stock',
};

// ---- Request bodies ----

const password = z.string().min(8, 'At least 8 characters').max(200);

export const PasswordBody = z.object({ password });
export type PasswordBody = z.infer<typeof PasswordBody>;

export const ChangePasswordBody = z.object({ currentPassword: z.string().max(200), newPassword: password });
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

const condition = z.enum(CONDITIONS);
const guardTerms = z.array(z.string().trim().min(1).max(100)).max(20);
const intervalMinutes = z.number().int().min(MIN_INTERVAL_MINUTES).max(7 * 24 * 60);

export const ProductCreate = z.object({
  name: z.string().trim().min(1).max(200),
  ean: z.string().trim().max(32).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /** Listings in these conditions count toward the product's price. */
  acceptedConditions: z.array(condition).min(1).default(['new']),
});
export type ProductCreate = z.input<typeof ProductCreate>;

export const ProductUpdate = ProductCreate.partial().extend({ archived: z.boolean().optional() });
export type ProductUpdate = z.input<typeof ProductUpdate>;

export const ParseUrlBody = z.object({ url: z.string().trim().min(1).max(2000) });
export type ParseUrlBody = z.infer<typeof ParseUrlBody>;

export const ListingCreate = z.object({
  store: z.string().trim().min(1).max(100),
  /** ASIN on Amazon; the page's path (and query) on custom stores. */
  externalId: z.string().trim().min(1).max(1000),
  /** One listing is created per marketplace. */
  marketplaces: z.array(z.string().min(1).max(100)).min(1),
  condition: condition.default('new'),
  /** Defaults to the store's default interval. */
  intervalMinutes: intervalMinutes.optional(),
  /** Every term must appear in the page title or the selected variation (case and spaces ignored). */
  guardInclude: guardTerms.default([]),
  /** No term may appear in the page title or the selected variation. */
  guardExclude: guardTerms.default([]),
});
export type ListingCreate = z.input<typeof ListingCreate>;

export const ListingUpdate = z.object({
  condition: condition.optional(),
  intervalMinutes: intervalMinutes.optional(),
  guardInclude: guardTerms.optional(),
  guardExclude: guardTerms.optional(),
  enabled: z.boolean().optional(),
});
export type ListingUpdate = z.input<typeof ListingUpdate>;

export const AlertRuleCreate = z
  .object({
    type: z.enum(ALERT_TYPES),
    /** EUR for target_price, percent (1-90) for drop_percent, unused otherwise. */
    threshold: z.number().positive().nullable().optional(),
  })
  .refine((r) => r.type !== 'target_price' || (r.threshold ?? 0) > 0, { message: 'A target price is required', path: ['threshold'] })
  .refine((r) => r.type !== 'drop_percent' || ((r.threshold ?? 0) >= 1 && (r.threshold ?? 0) <= 90), {
    message: 'Percentage must be between 1 and 90',
    path: ['threshold'],
  });
export type AlertRuleCreate = z.input<typeof AlertRuleCreate>;

export const AlertRuleUpdate = z.object({
  enabled: z.boolean().optional(),
  threshold: z.number().positive().nullable().optional(),
});
export type AlertRuleUpdate = z.input<typeof AlertRuleUpdate>;

export const NotificationChannelCreate = z.object({
  type: z.literal('gotify'),
  name: z.string().trim().min(1).max(100),
  /** Gotify server, e.g. http://127.0.0.1:8082 */
  url: z.url({ protocol: /^https?$/ }),
  /** Gotify application token. Never returned by the API. */
  token: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(true),
});
export type NotificationChannelCreate = z.input<typeof NotificationChannelCreate>;

export const NotificationChannelUpdate = NotificationChannelCreate.omit({ type: true }).partial();
export type NotificationChannelUpdate = z.input<typeof NotificationChannelUpdate>;

export const StorePreviewBody = z.object({ url: z.string().trim().min(1).max(2000) });
export type StorePreviewBody = z.infer<typeof StorePreviewBody>;

const hostName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'Not a valid domain');

const priceSelector = z.string().trim().min(1).max(1000).nullable();

export const CustomStoreCreate = z.object({
  /** The shop's host name as in its product URLs, e.g. "www.fnac.pt". The store's ID drops "www.". */
  host: hostName,
  label: z.string().trim().min(1).max(100),
  currency: z.enum(CURRENCIES).default('EUR'),
  defaultIntervalMinutes: intervalMinutes.optional(),
  /** Picked on a product page, for shops without product data (or whose data is wrong). */
  priceSelector: priceSelector.optional(),
  fetchMethod: z.enum(FETCH_METHODS).default('http'),
});
export type CustomStoreCreate = z.input<typeof CustomStoreCreate>;

export const CustomStoreUpdate = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  defaultIntervalMinutes: intervalMinutes.optional(),
  priceSelector: priceSelector.optional(),
  fetchMethod: z.enum(FETCH_METHODS).optional(),
});
export type CustomStoreUpdate = z.input<typeof CustomStoreUpdate>;

export const SelectorTestBody = z.object({
  url: z.string().trim().min(1).max(2000),
  selector: z.string().trim().min(1).max(1000),
});
export type SelectorTestBody = z.infer<typeof SelectorTestBody>;

export const LiveSessionCreate = z.object({ url: z.string().trim().min(1).max(2000) });
export type LiveSessionCreate = z.infer<typeof LiveSessionCreate>;

export const SignInStart = z.object({ store: z.string().min(1).max(100), marketplace: z.string().min(1).max(100) });
export type SignInStart = z.infer<typeof SignInStart>;

export const SignInSave = SignInStart.extend({ liveSessionId: z.string().min(1).max(100) });
export type SignInSave = z.infer<typeof SignInSave>;

export const SettingsUpdate = z.object({
  dailySummaryEnabled: z.boolean().optional(),
  /** Hour of the day (server time zone) the daily summary is sent. */
  dailySummaryHour: z.number().int().min(0).max(23).optional(),
});
export type SettingsUpdate = z.input<typeof SettingsUpdate>;

// ---- Responses ----

export interface AuthState {
  setupRequired: boolean;
  authenticated: boolean;
}

export interface ParsedUrl {
  store: StoreId;
  marketplace: string;
  externalId: string;
  canonicalUrl: string;
}

/** parse-url: a page of a store the app knows, or a shop that could be added as a custom store. */
export type ParseUrlResult = ({ kind: 'known' } & ParsedUrl) | { kind: 'unknown'; host: string; url: string };

/** What one request to an unknown shop's product page found. Nothing is stored. */
export interface StorePreview {
  /** The page address without tracking parameters; also what the listing will check. */
  url: string;
  host: string;
  /** The ID the store would get, e.g. "fnac.pt". */
  storeId: string;
  /** From the page's site name, else the domain. */
  suggestedLabel: string;
  /** Whether the page can be tracked: it has product data with a price, and no bot challenge. */
  trackable: boolean;
  /** Set when the shop answered with a bot challenge, e.g. "Cloudflare challenge". */
  protection: string | null;
  /** Where the product data came from: JSON-LD, microdata or price meta tags. */
  dataSource: 'json-ld' | 'microdata' | 'meta' | null;
  /** The page loaded but has no usable product data: the price can be picked on the page instead. */
  pickable: boolean;
  /** The condition the page states (schema.org itemCondition), when it states one. */
  condition: Condition | null;
  status: ObservationStatus;
  httpStatus: number | null;
  title: string | null;
  price: number | null;
  currency: Currency | null;
  inStock: boolean | null;
  availabilityText: string | null;
  seller: string | null;
  /** EAN/GTIN when the page publishes one. */
  gtin: string | null;
  error: string | null;
}

export interface Offer {
  seller: string | null;
  condition: string | null;
  price: number;
  shipping: number | null;
  currency: Currency;
}

export interface Observation {
  id: number;
  checkedAt: string;
  status: ObservationStatus;
  /** Whether the check used a signed-in session. */
  signedIn: boolean;
  title: string | null;
  /** The variation the page had selected, e.g. "M1 Pro-125H 32/1TB". */
  variantLabel: string | null;
  currency: Currency | null;
  /** Item price as listed. */
  price: number | null;
  /**
   * false when the page shows the price without VAT (Amazon Business usually does). headlineEur then adds
   * the delivery country's standard VAT rate, so it compares with other listings. null: not stated.
   */
  priceIncludesVat: boolean | null;
  /** Shipping the page showed for the delivery location, 0 when free, null when not shown. */
  shipping: number | null;
  /** price + shipping, when shipping is known. */
  deliveredPrice: number | null;
  /** The price shown first everywhere: deliveredPrice when known, else price. */
  headlinePrice: number | null;
  /** headlinePrice in EUR, using the day's ECB rate for other currencies. */
  headlineEur: number | null;
  inStock: boolean | null;
  availabilityText: string | null;
  /** Where the page priced delivery to, e.g. "Portugal". */
  deliveryLocation: string | null;
  /** "ip": the store guessed it from the server's public IP. "account": the signed-in account's address. */
  deliveryLocationSource: 'ip' | 'account' | null;
  deliveryText: string | null;
  seller: string | null;
  shipsFrom: string | null;
  offers: Offer[];
  error: string | null;
}

export interface Listing {
  id: number;
  productId: number;
  store: StoreId;
  marketplace: string;
  externalId: string;
  url: string;
  condition: Condition;
  intervalMinutes: number;
  enabled: boolean;
  guardInclude: string[];
  guardExclude: string[];
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  /** The most recent check, whatever its result. */
  latest: Observation | null;
  /** The most recent check that read a price. */
  lastOk: Observation | null;
}

export interface AlertRule {
  id: number;
  productId: number;
  type: AlertType;
  threshold: number | null;
  enabled: boolean;
  lastTriggeredAt: string | null;
}

export interface BestPrice {
  listingId: number;
  store: StoreId;
  marketplace: string;
  condition: Condition;
  headlinePrice: number;
  currency: Currency;
  headlineEur: number | null;
  checkedAt: string;
}

export interface ProductSummary {
  id: number;
  name: string;
  ean: string | null;
  acceptedConditions: Condition[];
  archived: boolean;
  createdAt: string;
  /** Cheapest headline price (compared in EUR) among enabled listings in an accepted condition. */
  best: BestPrice | null;
  listingCount: number;
  /** Listings whose latest check needs attention: variant_mismatch, captcha, blocked, signed_out, error, not_found. */
  issueCount: number;
  lastCheckedAt: string | null;
}

export interface ProductDetail extends ProductSummary {
  notes: string | null;
  listings: Listing[];
  alertRules: AlertRule[];
}

export interface HistoryPoint {
  t: string;
  status: ObservationStatus;
  /** Prices are null unless the check read a valid price (status "ok"). */
  headlinePrice: number | null;
  headlineEur: number | null;
}

export interface ProductHistory {
  listings: {
    listingId: number;
    store: StoreId;
    marketplace: string;
    condition: Condition;
    currency: Currency | null;
    points: HistoryPoint[];
  }[];
}

/** One plain load of a page with a picked price selector: does the selector find the price without a browser? */
export interface SelectorTest {
  url: string;
  selector: string;
  /** The selector found a price in the page as loaded without a browser: checks can be plain page loads. */
  worksWithoutBrowser: boolean;
  /** Suggested fetch method for the store. */
  fetchMethod: FetchMethod;
  price: number | null;
  currency: Currency | null;
  /** The element's text as found (without a browser). */
  text: string | null;
  title: string | null;
  protection: string | null;
  error: string | null;
}

export interface LiveSession {
  id: string;
}

/** After saving a sign-in: the store's sign-ins, and which other marketplaces the same sign-in works on. */
export interface SignInResult {
  sessions: StoreSessionStatus[];
  /** Other marketplaces of the store that showed you signed in too, and were saved. */
  alsoSignedIn: string[];
  /** Other marketplaces checked (one page each): stops at the first that doesn't take the sign-in. */
  checked: string[];
}

/** A store account signed in to through the live browser, for one marketplace. */
export interface StoreSessionStatus {
  store: StoreId;
  marketplace: string;
  /** "expired": a check found it signed out; checks carry on without the account until you sign in again. */
  status: 'none' | 'active' | 'expired';
  /** The name the store greets you with, e.g. "Gil". */
  accountName: string | null;
  /** Enabled listings in this marketplace: the ones the sign-in is for. */
  listingCount: number;
  signedInAt: string | null;
  lastUsedAt: string | null;
  expiredAt: string | null;
}

/** Messages from the web UI to the live browser. Coordinates are in page CSS pixels. */
export type LiveClientMessage =
  | { t: 'viewport'; width: number; height: number }
  | { t: 'mouse'; type: 'move' | 'down' | 'up'; x: number; y: number; button?: 'left' | 'middle' | 'right'; clickCount?: number }
  | { t: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { t: 'key'; type: 'down' | 'up'; key: string; text?: string }
  /** Text pasted from the viewer's clipboard (e.g. from a password manager), typed into the focused field. */
  | { t: 'text'; text: string }
  | { t: 'nav'; action: 'goto' | 'back' | 'forward' | 'reload'; url?: string }
  | { t: 'pick'; on: boolean }
  /** Widen the picked element to its parent (when the click landed on part of the price). */
  | { t: 'pickParent' };

/** Messages from the live browser to the web UI. */
export type LiveServerMessage =
  /** A JPEG screenshot (base64) of the viewport, w x h CSS pixels. */
  | { t: 'frame'; data: string; w: number; h: number }
  | { t: 'state'; url: string; title: string; loading: boolean }
  | { t: 'picked'; selector: string; text: string; price: number | null }
  | { t: 'error'; message: string }
  | { t: 'closed'; reason: string };

export interface RateGroupStatus {
  group: RateGroupId;
  label: string;
  stores: StoreId[];
  /** A custom store's own group (renamed and deleted from the Stores page). */
  custom: boolean;
  enabledListings: number;
  /** Requests per hour the enabled listings' intervals add up to. */
  plannedPerHour: number;
  /** Requests actually made in the last 60 minutes, by result. */
  actualLastHour: { total: number; byStatus: Partial<Record<ObservationStatus, number>> };
  warnPerHour: number;
  dangerPerHour: number;
  level: 'ok' | 'warn' | 'danger';
  /** Checks are paused until then, after a captcha or block. */
  pausedUntil: string | null;
  pauseReason: string | null;
}

export interface NotificationChannel {
  id: number;
  type: 'gotify';
  name: string;
  url: string;
  tokenSet: boolean;
  enabled: boolean;
}

export interface Settings {
  dailySummaryEnabled: boolean;
  dailySummaryHour: number;
  timeZone: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
