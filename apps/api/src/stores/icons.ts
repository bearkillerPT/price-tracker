// Store favicons, shown next to store names. Learned from a page a check (or a preview that became a listing)
// already loaded: the icon its <link rel="icon"> points at, else /favicon.ico. That's one small request per
// store, ever; a store without a usable icon is tried again a week later.
import * as cheerio from 'cheerio';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { storeIcons } from '../db/schema.ts';
import { log } from '../log.ts';
import { USER_AGENT } from './http.ts';
import { isPrivateHost } from './private-hosts.ts';
import type { PageResponse } from './types.ts';

const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Raster images only (an SVG served from this origin could run scripts), told apart by their first bytes. */
export function imageType(data: Buffer): string | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Where to look for the page's icon, best first: a small raster icon it links to, then /favicon.ico. */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = $('link[rel][href]')
    .toArray()
    .map((el) => {
      const rel = ($(el).attr('rel') ?? '').toLowerCase().split(/\s+/);
      const href = $(el).attr('href') ?? '';
      const size = Number(($(el).attr('sizes') ?? '').match(/^(\d+)x\d+/)?.[1] ?? 32);
      const svg = /svg/i.test($(el).attr('type') ?? '') || /\.svg(\?|$)/i.test(href);
      // Plain icons near 32 px first; apple-touch-icon (180 px) only as a fallback
      const rank = rel.includes('icon') ? Math.abs(size - 32) : rel.includes('apple-touch-icon') ? 1000 : -1;
      return { href, rank, svg };
    })
    .filter((l) => l.rank >= 0 && !l.svg)
    .sort((a, b) => a.rank - b.rank);
  const urls: string[] = [];
  for (const l of links) {
    try {
      urls.push(new URL(l.href, pageUrl).toString());
      break; // the best one; /favicon.ico is the fallback
    } catch {
      // not a URL; try the next
    }
  }
  urls.push(new URL('/favicon.ico', pageUrl).toString());
  return [...new Set(urls)];
}

async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    if (size > max) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Loads an image from a public address (each redirect checked too). */
export async function fetchIcon(start: string): Promise<{ contentType: string; data: Buffer } | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = new URL(current);
    if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) return null;
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT, accept: 'image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5' },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, url).toString();
      continue;
    }
    if (res.status !== 200) {
      await res.body?.cancel();
      return null;
    }
    const data = await readCapped(res, MAX_BYTES);
    const contentType = data && data.length > 0 ? imageType(data) : null;
    return contentType && data ? { contentType, data } : null;
  }
  return null;
}

export class StoreIcons {
  /** Stores this process has already looked up or learned, so checks don't ask the database each time. */
  private settled = new Set<string>();
  private pending = new Set<string>();

  constructor(
    private db: Db,
    private load: typeof fetchIcon = fetchIcon,
    private now: () => Date = () => new Date(),
  ) {}

  /** Each store with an icon, and a version that changes when the icon does (for caching). */
  async versions(): Promise<Record<string, string>> {
    const rows = await this.db.select({ store: storeIcons.store, ok: storeIcons.ok, fetchedAt: storeIcons.fetchedAt }).from(storeIcons);
    return Object.fromEntries(rows.filter((r) => r.ok).map((r) => [r.store, String(r.fetchedAt.getTime())]));
  }

  async get(store: string): Promise<{ contentType: string; data: Buffer } | null> {
    const [row] = await this.db.select().from(storeIcons).where(eq(storeIcons.store, store));
    return row?.ok && row.contentType && row.data ? { contentType: row.contentType, data: Buffer.from(row.data, 'base64') } : null;
  }

  async forget(store: string): Promise<void> {
    await this.db.delete(storeIcons).where(eq(storeIcons.store, store));
    this.settled.delete(store);
  }

  /** Learns the store's icon from a page it served, unless it's known already. Runs in the background. */
  learn(store: string, page: Pick<PageResponse, 'status' | 'url' | 'body'>): Promise<void> {
    if (page.status !== 200 || this.settled.has(store) || this.pending.has(store)) return Promise.resolve();
    this.pending.add(store);
    return this.fetchAndSave(store, page)
      .catch((err) => log.warn('could not get the store icon', { store, error: err }))
      .finally(() => this.pending.delete(store));
  }

  private async fetchAndSave(store: string, page: Pick<PageResponse, 'url' | 'body'>): Promise<void> {
    const [row] = await this.db.select({ ok: storeIcons.ok, fetchedAt: storeIcons.fetchedAt }).from(storeIcons).where(eq(storeIcons.store, store));
    if (row && (row.ok || this.now().getTime() - row.fetchedAt.getTime() < RETRY_MS)) {
      this.settled.add(store);
      return;
    }
    let found: { url: string; contentType: string; data: Buffer } | null = null;
    for (const url of iconCandidates(page.body, page.url)) {
      const icon = await this.load(url).catch(() => null);
      if (icon) {
        found = { url, ...icon };
        break;
      }
    }
    const values = {
      ok: !!found,
      contentType: found?.contentType ?? null,
      data: found?.data.toString('base64') ?? null,
      sourceUrl: found?.url ?? null,
      fetchedAt: this.now(),
    };
    await this.db.insert(storeIcons).values({ store, ...values }).onConflictDoUpdate({ target: storeIcons.store, set: values });
    this.settled.add(store);
    log.info(found ? 'store icon saved' : 'no store icon found', { store, url: found?.url });
  }
}
