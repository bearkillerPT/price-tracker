import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { Offer } from '@price-tracker/shared';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });

/** The single app account. No other table references it, so resetting it never touches tracking data. */
export const appAccount = pgTable(
  'app_account',
  {
    id: integer('id').primaryKey().default(1),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('app_account_single_row', sql`${t.id} = 1`)],
);

/** Login sessions of the app itself (not store sessions). Only a hash of the cookie's token is stored. */
export const appSessions = pgTable('app_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  ean: text('ean'),
  notes: text('notes'),
  acceptedConditions: text('accepted_conditions').array().notNull().default(sql`'{new}'::text[]`),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const listings = pgTable(
  'listings',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    store: text('store').notNull(),
    marketplace: text('marketplace').notNull(),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    condition: text('condition').notNull().default('new'),
    intervalMinutes: integer('interval_minutes').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    guardInclude: text('guard_include').array().notNull().default(sql`'{}'::text[]`),
    guardExclude: text('guard_exclude').array().notNull().default(sql`'{}'::text[]`),
    lastCheckedAt: timestamptz('last_checked_at'),
    nextCheckAt: timestamptz('next_check_at').notNull().defaultNow(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('listings_unique_page').on(t.productId, t.store, t.marketplace, t.externalId),
    index('listings_next_check').on(t.nextCheckAt),
  ],
);

/** One row per check of a listing. The rate counts on the stores page are counted from here too. */
export const observations = pgTable(
  'observations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    listingId: integer('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    /** Copied from the listing so request counts per store survive listing edits. */
    store: text('store').notNull(),
    marketplace: text('marketplace').notNull(),
    checkedAt: timestamptz('checked_at').notNull().defaultNow(),
    status: text('status').notNull(),
    signedIn: boolean('signed_in').notNull().default(false),
    title: text('title'),
    variantLabel: text('variant_label'),
    currency: text('currency'),
    price: money('price'),
    /** false: the page showed the price without VAT (Amazon Business). */
    priceIncludesVat: boolean('price_includes_vat'),
    shipping: money('shipping'),
    deliveredPrice: money('delivered_price'),
    headlinePrice: money('headline_price'),
    /** headline_price converted with the ECB rate of the day of the check. */
    headlineEur: money('headline_eur'),
    inStock: boolean('in_stock'),
    availabilityText: text('availability_text'),
    deliveryLocation: text('delivery_location'),
    deliveryLocationSource: text('delivery_location_source'),
    deliveryText: text('delivery_text'),
    seller: text('seller'),
    shipsFrom: text('ships_from'),
    offers: jsonb('offers').$type<Offer[]>().notNull().default(sql`'[]'::jsonb`),
    error: text('error'),
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms'),
    /** HTTP requests the check made, redirects included. */
    requestCount: integer('request_count').notNull().default(0),
    /** Extra data the parser found, kept for debugging. */
    raw: jsonb('raw').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('observations_listing_time').on(t.listingId, t.checkedAt.desc()),
    index('observations_store_time').on(t.store, t.checkedAt),
  ],
);

export const alertRules = pgTable('alert_rules', {
  id: serial('id').primaryKey(),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  threshold: money('threshold'),
  enabled: boolean('enabled').notNull().default(true),
  /** drop_percent: the highest product price since the rule last fired. */
  referencePrice: money('reference_price'),
  lastTriggeredAt: timestamptz('last_triggered_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const alertEvents = pgTable('alert_events', {
  id: serial('id').primaryKey(),
  ruleId: integer('rule_id').references(() => alertRules.id, { onDelete: 'set null' }),
  productId: integer('product_id').references(() => products.id, { onDelete: 'cascade' }),
  triggeredAt: timestamptz('triggered_at').notNull().defaultNow(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  delivered: boolean('delivered').notNull().default(false),
});

/** Per rate group: whether checks are paused after a captcha or block. */
export const storeState = pgTable('store_state', {
  rateGroup: text('rate_group').primaryKey(),
  pausedUntil: timestamptz('paused_until'),
  pauseReason: text('pause_reason'),
  consecutiveBlocks: integer('consecutive_blocks').notNull().default(0),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const notificationChannels = pgTable('notification_channels', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  token: text('token').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey().default(1),
    dailySummaryEnabled: boolean('daily_summary_enabled').notNull().default(true),
    dailySummaryHour: integer('daily_summary_hour').notNull().default(10),
    /** Local date (YYYY-MM-DD) the last daily summary went out. */
    lastDailySummaryDate: text('last_daily_summary_date'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('settings_single_row', sql`${t.id} = 1`)],
);

/** ECB reference rates: how many units of the currency one euro buys. */
export const fxRates = pgTable('fx_rates', {
  currency: text('currency').primaryKey(),
  perEur: numeric('per_eur', { precision: 14, scale: 6, mode: 'number' }).notNull(),
  rateDate: text('rate_date').notNull(),
  fetchedAt: timestamptz('fetched_at').notNull().defaultNow(),
});

/** Shops added from the UI. Each is one domain, one marketplace and its own rate group; see stores/generic. */
export const customStores = pgTable('custom_stores', {
  /** The domain without "www.", e.g. "fnac.pt". Also the marketplace and rate group ID. */
  id: text('id').primaryKey(),
  /** Host requests go to, as in the shop's product URLs, e.g. "www.fnac.pt". */
  host: text('host').notNull(),
  label: text('label').notNull(),
  currency: text('currency').notNull().default('EUR'),
  defaultIntervalMinutes: integer('default_interval_minutes').notNull().default(180),
  /** CSS selector of the price element, picked on a product page. */
  priceSelector: text('price_selector'),
  /** "http" or "browser" (Chromium, for prices added by the page's scripts). */
  fetchMethod: text('fetch_method').notNull().default('http'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

/**
 * Store accounts signed in to through the live browser, one per store and marketplace (Amazon keeps a
 * session per domain). The browser's cookies and local storage (Playwright storageState) are kept
 * encrypted with SESSION_KEY; checks send the cookies with the user agent of the browser that signed in.
 */
export const storeSessions = pgTable(
  'store_sessions',
  {
    id: serial('id').primaryKey(),
    store: text('store').notNull(),
    marketplace: text('marketplace').notNull(),
    /** AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>", base64. */
    stateEncrypted: text('state_encrypted').notNull(),
    userAgent: text('user_agent').notNull(),
    accountName: text('account_name'),
    status: text('status').notNull().default('active'),
    signedInAt: timestamptz('signed_in_at').notNull().defaultNow(),
    lastUsedAt: timestamptz('last_used_at'),
    expiredAt: timestamptz('expired_at'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('store_sessions_store_marketplace').on(t.store, t.marketplace)],
);
