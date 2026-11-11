// Previews of unknown shops: one request to a product page, to see whether the shop can be added as a
// custom store. The result is kept for a while, so adding the listing right after doesn't fetch the
// page a second time: it becomes the listing's first check.
import type { Condition, SelectorTest, StorePreview } from '@price-tracker/shared';
import { storeIdFromHost } from '@price-tracker/shared';
import { countryFromHost } from '../catalog.ts';
import { genericAdapter, pageRef } from './generic/adapter.ts';
import { emptyOutcome } from './types.ts';
import type { CheckOutcome, PageFetcher, PageResponse } from './types.ts';

const KEEP_MS = 15 * 60 * 1000;
/** At most one preview request per shop in this window. */
const MIN_GAP_MS = 10_000;

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** schema.org itemCondition -> the listing condition it suggests. */
const CONDITION: Record<string, Condition> = {
  NewCondition: 'new',
  UsedCondition: 'used',
  RefurbishedCondition: 'refurbished',
  DamagedCondition: 'used',
};

type PreviewRaw = { protection?: string; dataSource?: StorePreview['dataSource']; gtin?: string | null; siteName?: string | null; condition?: string | null; selectorText?: string | null };

export class Previewer {
  private results = new Map<string, { outcome: CheckOutcome; at: Date }>();
  /** Pages as loaded, so a selector test right after a preview reads the same page instead of loading it again. */
  private pages = new Map<string, { response: PageResponse; at: number }>();
  private lastRequest = new Map<string, number>();

  constructor(
    private fetchPage: PageFetcher,
    private now: () => Date = () => new Date(),
  ) {}

  /** Milliseconds until this shop may be previewed again; 0 when it may now. */
  waitFor(host: string): number {
    const last = this.lastRequest.get(storeIdFromHost(host));
    return last ? Math.max(0, last + MIN_GAP_MS - this.now().getTime()) : 0;
  }

  private static pageUrl(url: URL): string {
    return `${url.protocol}//${url.host.toLowerCase()}${pageRef(url)}`;
  }

  /** Whether this page was loaded recently enough to be read again without a request. */
  hasRecentPage(url: URL): boolean {
    const hit = this.pages.get(Previewer.pageUrl(url));
    return !!hit && this.now().getTime() - hit.at < KEEP_MS;
  }

  /** Fetches (and keeps) the page; with reuse, a recent copy is read instead of loading it again. */
  private fetcher(reuse: boolean): PageFetcher {
    return async (pageUrl, options) => {
      const hit = this.pages.get(pageUrl);
      if (reuse && hit && this.now().getTime() - hit.at < KEEP_MS) return hit.response;
      this.lastRequest.set(storeIdFromHost(new URL(pageUrl).hostname), this.now().getTime());
      const response = await this.fetchPage(pageUrl, options);
      for (const [k, v] of this.pages) if (this.now().getTime() - v.at >= KEEP_MS) this.pages.delete(k);
      this.pages.set(pageUrl, { response, at: this.now().getTime() });
      return response;
    };
  }

  /** One plain load of the page through the generic adapter, kept for take(). */
  private async load(url: URL, priceSelector: string | null, reuse: boolean): Promise<{ pageUrl: string; host: string; id: string; outcome: CheckOutcome }> {
    const host = url.hostname.toLowerCase();
    const id = storeIdFromHost(host);
    const ref = pageRef(url);
    const pageUrl = Previewer.pageUrl(url);

    const marketplace = { id, store: id, host: url.host.toLowerCase(), country: countryFromHost(host), label: id, currency: 'EUR' as const, priceSelector, fetchMethod: 'http' as const };
    let outcome: CheckOutcome;
    try {
      outcome = await genericAdapter.check({ marketplace, externalId: ref, url: pageUrl }, this.fetcher(reuse));
    } catch (err) {
      outcome = { ...emptyOutcome('error', err instanceof Error ? err.message : String(err)), requestCount: 1 };
    }
    this.results.set(pageUrl, { outcome, at: this.now() });
    return { pageUrl, host, id, outcome };
  }

  async preview(url: URL): Promise<StorePreview> {
    const { pageUrl, host, id, outcome } = await this.load(url, null, false);
    const raw = outcome.raw as PreviewRaw;
    const dataSource = raw.dataSource ?? null;
    return {
      url: pageUrl,
      host,
      storeId: id,
      suggestedLabel: raw.siteName ?? titleCase(id.split('.')[0]!),
      trackable: !raw.protection && dataSource !== null && (outcome.status === 'ok' || outcome.status === 'unavailable'),
      protection: raw.protection ?? null,
      dataSource,
      pickable: !raw.protection && outcome.httpStatus === 200 && (dataSource === null || outcome.price === null),
      condition: (raw.condition && CONDITION[raw.condition]) || null,
      status: outcome.status,
      httpStatus: outcome.httpStatus,
      title: outcome.title,
      price: outcome.price,
      currency: outcome.currency,
      inStock: outcome.inStock,
      availabilityText: outcome.availabilityText,
      seller: outcome.seller,
      gtin: raw.gtin ?? null,
      error: outcome.error,
    };
  }

  /**
   * Reads the picked selector in the page as loaded without a browser (the preview's copy when there is a
   * recent one, else one new load): if it finds the price, checks can be plain page loads; if not (the
   * page's scripts add the price), they need the browser.
   */
  async testSelector(url: URL, selector: string): Promise<SelectorTest> {
    const { pageUrl, outcome } = await this.load(url, selector, true);
    const raw = outcome.raw as PreviewRaw;
    const works = (outcome.status === 'ok' || outcome.status === 'unavailable') && outcome.price !== null;
    return {
      url: pageUrl,
      selector,
      worksWithoutBrowser: works,
      fetchMethod: works || raw.protection ? 'http' : 'browser',
      price: outcome.price,
      currency: outcome.currency,
      text: raw.selectorText ?? null,
      title: outcome.title,
      protection: raw.protection ?? null,
      error: works ? null : outcome.error,
    };
  }

  /** A recent successful load of this page, for use as a new listing's first check. Used once. */
  take(pageUrl: string): { outcome: CheckOutcome; at: Date } | null {
    const hit = this.results.get(pageUrl);
    this.results.delete(pageUrl);
    if (!hit || this.now().getTime() - hit.at.getTime() >= KEEP_MS) return null;
    return hit.outcome.status === 'ok' || hit.outcome.status === 'unavailable' ? hit : null;
  }
}
