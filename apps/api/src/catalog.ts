// The catalog: built-in stores plus the custom stores in the database. Kept in memory and refreshed
// whenever a custom store is added, changed or removed.
import {
  BUILT_IN_CATALOG,
  CUSTOM_STORE_DEFAULTS,
  isCurrency,
  marketplaceIn,
  marketplacesOfStore,
  rateGroupIn,
  storeIn,
} from '@price-tracker/shared';
import type { Catalog, MarketplaceInfo, RateGroupInfo, StoreInfo } from '@price-tracker/shared';
import type { Db } from './db/client.ts';
import { customStores } from './db/schema.ts';

type CustomStoreRow = typeof customStores.$inferSelect;

/** Two-letter top-level domain as a country code ("fnac.pt" -> "PT"), or "". */
export const countryFromHost = (host: string): string => {
  const tld = host.split('.').pop() ?? '';
  return /^[a-z]{2}$/i.test(tld) ? tld.toUpperCase() : '';
};

export function customStoreEntries(
  row: Pick<CustomStoreRow, 'id' | 'host' | 'label' | 'currency' | 'defaultIntervalMinutes'> & Partial<Pick<CustomStoreRow, 'priceSelector' | 'fetchMethod'>>,
): {
  store: StoreInfo;
  marketplace: MarketplaceInfo;
  rateGroup: RateGroupInfo;
} {
  return {
    store: {
      id: row.id,
      label: row.label,
      rateGroup: row.id,
      implemented: true,
      requiresSignIn: false,
      defaultIntervalMinutes: row.defaultIntervalMinutes,
      externalIdLabel: 'Page',
      custom: true,
      canSignIn: false,
    },
    marketplace: {
      id: row.id,
      store: row.id,
      host: row.host,
      country: countryFromHost(row.host),
      label: row.label,
      currency: isCurrency(row.currency) ? row.currency : 'EUR',
      fetchMethod: row.fetchMethod === 'browser' ? 'browser' : 'http',
      priceSelector: row.priceSelector ?? null,
    },
    rateGroup: {
      id: row.id,
      label: row.label,
      stores: [row.id],
      warnPerHour: CUSTOM_STORE_DEFAULTS.warnPerHour,
      dangerPerHour: CUSTOM_STORE_DEFAULTS.dangerPerHour,
    },
  };
}

export class CatalogService {
  private current: Catalog = BUILT_IN_CATALOG;

  constructor(private db: Db) {}

  async refresh(): Promise<Catalog> {
    const rows = await this.db.select().from(customStores).orderBy(customStores.label);
    const entries = rows.map(customStoreEntries);
    this.current = {
      stores: [...BUILT_IN_CATALOG.stores, ...entries.map((e) => e.store)],
      marketplaces: [...BUILT_IN_CATALOG.marketplaces, ...entries.map((e) => e.marketplace)],
      rateGroups: [...BUILT_IN_CATALOG.rateGroups, ...entries.map((e) => e.rateGroup)],
    };
    return this.current;
  }

  get(): Catalog {
    return this.current;
  }

  store = (id: string) => storeIn(this.current, id);
  marketplace = (id: string) => marketplaceIn(this.current, id);
  marketplacesOf = (store: string) => marketplacesOfStore(this.current, store);
  rateGroup = (id: string) => rateGroupIn(this.current, id);
}
