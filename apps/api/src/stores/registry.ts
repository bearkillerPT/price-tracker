import { marketplaceIn, storeIdFromHost, storeIn } from '@price-tracker/shared';
import type { Catalog, ParseUrlResult } from '@price-tracker/shared';
import { amazonAdapter, amazonBusinessAdapter } from './amazon/adapter.ts';
import { genericAdapter, pageRef } from './generic/adapter.ts';
import { isPrivateHost } from './private-hosts.ts';
import type { CheckAdapter, StoreAdapter } from './types.ts';

const BUILT_IN: Record<string, StoreAdapter> = {
  amazon: amazonAdapter,
  'amazon-business': amazonBusinessAdapter,
};

/** The adapter that checks a store's listings: its own for built-in stores, the generic one for custom stores. */
export function adapterFor(store: string, catalog: Catalog): CheckAdapter | undefined {
  const info = storeIn(catalog, store);
  if (!info?.implemented) return undefined;
  return BUILT_IN[store] ?? (info.custom ? genericAdapter : undefined);
}

export function toUrl(raw: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    return /^https?:$/.test(url.protocol) && url.hostname ? url : null;
  } catch {
    return null;
  }
}

export type ParseOutcome = ParseUrlResult | { kind: 'invalid'; reason: string };

/**
 * Recognises a product URL: a built-in store's, a custom store's, or an unknown shop that could be added
 * as a custom store. Never makes a request.
 */
export function parseProductUrl(raw: string, catalog: Catalog): ParseOutcome {
  const url = toUrl(raw);
  if (!url) return { kind: 'invalid', reason: "That isn't a web address." };
  if (isPrivateHost(url.hostname)) return { kind: 'invalid', reason: 'Only public shops can be tracked, not local or private network addresses.' };

  for (const adapter of Object.values(BUILT_IN)) {
    const hit = adapter.parseUrl(url);
    if (hit && storeIn(catalog, adapter.store)?.implemented) {
      return {
        kind: 'known',
        store: adapter.store,
        marketplace: hit.marketplace.id,
        externalId: hit.externalId,
        canonicalUrl: adapter.canonicalUrl(hit.marketplace, hit.externalId),
      };
    }
  }
  const id = storeIdFromHost(url.hostname);
  // Amazon's own stores need its adapter; the generic reader can't handle them
  if (/(^|\.)amazon\.[a-z.]+$/.test(id)) {
    return {
      kind: 'invalid',
      reason:
        'Only the EU Amazon stores are supported, with full product URLs (e.g. https://www.amazon.de/dp/B0FH6K3HVC). Short links like amzn.eu need opening first.',
    };
  }
  if (/^amzn\.(eu|to)$|^a\.co$/.test(id)) return { kind: 'invalid', reason: 'Short Amazon links need opening first; paste the full product URL.' };

  const store = storeIn(catalog, id);
  const marketplace = marketplaceIn(catalog, id);
  const ref = pageRef(url);
  if (store?.custom && marketplace) {
    return { kind: 'known', store: id, marketplace: id, externalId: ref, canonicalUrl: genericAdapter.canonicalUrl(marketplace, ref) };
  }
  return { kind: 'unknown', host: url.hostname.toLowerCase(), url: `${url.protocol}//${url.host.toLowerCase()}${ref}` };
}

export function canonicalUrlFor(catalog: Catalog, store: string, marketplaceId: string, externalId: string): string | null {
  const adapter = adapterFor(store, catalog);
  const marketplace = marketplaceIn(catalog, marketplaceId);
  if (!adapter || !marketplace || marketplace.store !== store) return null;
  return adapter.canonicalUrl(marketplace, externalId);
}
