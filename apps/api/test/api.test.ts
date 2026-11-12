// End-to-end API test against a real Postgres (the dev one from compose.dev.yaml), with saved Amazon
// pages served instead of Amazon and a fake Gotify server. Skipped when Postgres isn't reachable.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Catalog, ProductDetail, RateGroupStatus, SelectorTest, SignInResult, StorePreview, StoreSessionStatus } from '@price-tracker/shared';
import { resetPassword } from '../src/auth/account.ts';
import { LiveSessions } from '../src/browser/live.ts';
import { BrowserManager } from '../src/browser/manager.ts';
import { attachLiveSocket } from '../src/browser/socket.ts';
import { CatalogService } from '../src/catalog.ts';
import { dailySummaryText } from '../src/checks/housekeeping.ts';
import { createCheckRunner } from '../src/checks/run-check.ts';
import { createDb } from '../src/db/client.ts';
import { migrateAndSeed } from '../src/db/migrate.ts';
import { createApp } from '../src/http/app.ts';
import { createNotifier } from '../src/notify/index.ts';
import { StoreIcons } from '../src/stores/icons.ts';
import { Previewer } from '../src/stores/preview.ts';
import { StoreSessions } from '../src/stores/sessions.ts';
import { setAllowPrivateHosts } from '../src/stores/private-hosts.ts';
import type { PageFetcher } from '../src/stores/types.ts';
import { amazonFixture, shopFixture, signedInAmazonPage } from './fixtures.ts';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://price_tracker:price_tracker@127.0.0.1:55432/postgres';
const TEST_DB = 'price_tracker_test';
const testUrl = ADMIN_URL.replace(/\/[^/?]*(\?|$)/, `/${TEST_DB}$1`);

async function recreateTestDatabase(): Promise<boolean> {
  const admin = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
  try {
    await admin.connect();
  } catch {
    return false;
  }
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();
  return true;
}

const available = await recreateTestDatabase();
if (!available) console.warn(`Skipping API test: no Postgres at ${ADMIN_URL} (run \`pnpm db:up\`)`);

describe.skipIf(!available)('API end to end', () => {
  const { db, pool } = createDb(testUrl);
  const pages = new Map<string, { status: number; body: string; headers?: Record<string, string> }>();
  // What a URL returns to a signed-in check, when that differs (Amazon Business shares Amazon's URLs)
  const signedInPages = new Map<string, { status: number; body: string }>();
  let fetches = 0;
  // Signed-in checks: what the last fetch was sent with, and a hook to play the store renewing a cookie
  let lastSession: { cookies: string; userAgent: string } | null = null;
  let onSessionFetch: ((url: string, jar: import('tough-cookie').CookieJar) => Promise<void>) | null = null;
  const fetchPage: PageFetcher = async (url, options) => {
    fetches++;
    lastSession = options.session ? { cookies: await options.session.jar.getCookieString(url), userAgent: options.session.userAgent } : null;
    if (options.session && onSessionFetch) await onSessionFetch(url, options.session.jar);
    const page = (options.session && signedInPages.get(url)) || pages.get(url);
    if (!page) throw new Error(`test has no page for ${url}`);
    return { ...page, url, requestCount: 1, durationMs: 3 };
  };
  const catalog = new CatalogService(db);
  const storeSessions = new StoreSessions(db, randomBytes(32).toString('base64'));
  // Store icons come from a fake loader: a 1x1 PNG for whatever the page points at
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const iconRequests: string[] = [];
  const storeIcons = new StoreIcons(db, async (url) => {
    iconRequests.push(url);
    return { contentType: 'image/png', data: PNG };
  });
  const checks = createCheckRunner({ db, catalog, fetchPage, notify: createNotifier(db), sessions: storeSessions, icons: storeIcons });
  const runCheck = checks.runCheck;
  const previewer = new Previewer(fetchPage);
  const browsers = new BrowserManager(500);
  // Marketplace home pages, for the sign-in check of other stores: a local fake, never the real Amazon
  let homeBase = 'http://127.0.0.1:9';
  const liveSessions = new LiveSessions(browsers);
  const gotify: { key: string | undefined; title: string; message: string; priority: number }[] = [];
  let gotifyServer: http.Server;
  let appServer: http.Server;
  let base = '';
  let cookie = '';

  const listen = (server: http.Server) =>
    new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

  async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      cookie = pair!.endsWith('=') ? '' : pair!;
    }
    return { status: res.status, body: (await res.json()) as T };
  }

  beforeAll(async () => {
    await migrateAndSeed(db);
    await catalog.refresh();
    gotifyServer = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        gotify.push({ key: req.headers['x-gotify-key'] as string | undefined, ...JSON.parse(data) });
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
    });
    const gotifyUrl = await listen(gotifyServer);
    appServer = http.createServer(createApp({ db, catalog, wake: () => {}, previewer, recordOutcome: checks.recordOutcome, liveSessions, storeSessions, storeIcons, storeHomeUrl: (m) => `${homeBase}/home/${m.id}`, webDist: null }));
    attachLiveSocket(appServer, db, liveSessions);
    base = await listen(appServer);
    (globalThis as any).__gotifyUrl = gotifyUrl;
  });

  afterAll(async () => {
    await liveSessions.closeAll();
    await browsers.shutdown();
    appServer?.close();
    gotifyServer?.close();
    await pool.end();
  });

  let productId = 0;
  const listingFor = (p: ProductDetail, marketplace: string) => p.listings.find((l) => l.marketplace === marketplace)!;

  it('asks for a password first, then signs in', async () => {
    expect((await api('GET', '/api/auth/state')).body).toEqual({ setupRequired: true, authenticated: false });
    expect((await api('GET', '/api/products')).status).toBe(401);
    expect((await api('POST', '/api/auth/setup', { password: 'short' })).status).toBe(400);
    expect((await api('POST', '/api/auth/setup', { password: 'correct horse' })).body).toEqual({ setupRequired: false, authenticated: true });
    expect((await api('POST', '/api/auth/setup', { password: 'another one' })).status).toBe(409);
    expect((await api('GET', '/api/products')).body).toEqual([]);
  });

  it('adds a product, one ASIN in three Amazon stores, alerts and a Gotify channel', async () => {
    const created = await api<ProductDetail>('POST', '/api/products', { name: 'Minisforum M1 Pro-125H 32GB/1TB' });
    expect(created.status).toBe(201);
    productId = created.body.id;

    const parsed = await api('POST', '/api/listings/parse-url', { url: 'https://www.amazon.de/Mini-PC-MINISFORUM-M1-Pro-125H-Threads/dp/B0FH6K3HVC?th=1' });
    expect(parsed.body).toMatchObject({ store: 'amazon', marketplace: 'amazon.de', externalId: 'B0FH6K3HVC' });
    expect((await api('POST', '/api/listings/parse-url', { url: 'https://amzn.eu/d/abc' })).status).toBe(422);

    const withListings = await api<ProductDetail>('POST', `/api/products/${productId}/listings`, {
      store: 'amazon',
      externalId: 'B0FH6K3HVC',
      marketplaces: ['amazon.de', 'amazon.es', 'amazon.se'],
      guardInclude: ['32GB', '1TB'],
      guardExclude: ['barebone', '0/0'],
    });
    expect(withListings.status).toBe(201);
    expect(withListings.body.listings.map((l) => [l.marketplace, l.url, l.intervalMinutes])).toEqual([
      ['amazon.de', 'https://www.amazon.de/dp/B0FH6K3HVC', 180],
      ['amazon.es', 'https://www.amazon.es/dp/B0FH6K3HVC', 180],
      ['amazon.se', 'https://www.amazon.se/dp/B0FH6K3HVC', 180],
    ]);
    expect((await api('POST', `/api/products/${productId}/listings`, { store: 'amazon', externalId: 'B0FH6K3HVC', marketplaces: ['amazon.de'] })).status).toBe(409);
    expect((await api('POST', `/api/products/${productId}/listings`, { store: 'amazon-business', externalId: 'B0FH6K3HVC', marketplaces: ['amazon.de'] })).status).toBe(422); // amazon.de isn't an Amazon Business marketplace

    expect((await api('POST', `/api/products/${productId}/alerts`, { type: 'target_price' })).status).toBe(400);
    await api('POST', `/api/products/${productId}/alerts`, { type: 'any_drop' });
    const rules = await api<ProductDetail>('POST', `/api/products/${productId}/alerts`, { type: 'target_price', threshold: 960 });
    expect(rules.body.alertRules.map((r) => r.type)).toEqual(['any_drop', 'target_price']);

    const channels = await api('POST', '/api/notification-channels', { type: 'gotify', name: 'Test', url: (globalThis as any).__gotifyUrl, token: 'app-token' });
    expect(channels.body).toEqual([{ id: expect.any(Number), type: 'gotify', name: 'Test', url: (globalThis as any).__gotifyUrl, tokenSet: true, enabled: true }]);
    expect((await api('POST', `/api/notification-channels/${channels.body[0].id}/test`)).body).toEqual({ ok: true });
    expect(gotify.pop()).toMatchObject({ key: 'app-token', title: 'Price tracker' });
  });

  it('checks each store and alerts on the drop and the target', async () => {
    const before = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    pages.set(listingFor(before, 'amazon.es').url, { status: 200, body: amazonFixture('es-in-stock-free-delivery') });
    pages.set(listingFor(before, 'amazon.de').url, { status: 200, body: amazonFixture('de-in-stock-delivery-fee') });
    pages.set(listingFor(before, 'amazon.se').url, { status: 200, body: amazonFixture('se-unavailable') });

    await runCheck(listingFor(before, 'amazon.es').id);
    expect(gotify).toHaveLength(0); // first price: nothing to compare with, and above the target
    await runCheck(listingFor(before, 'amazon.de').id);
    await runCheck(listingFor(before, 'amazon.se').id);

    const p = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    expect(p.best).toMatchObject({ marketplace: 'amazon.de', headlinePrice: 958.22, currency: 'EUR', headlineEur: 958.22 });
    expect(p.issueCount).toBe(0);
    expect(listingFor(p, 'amazon.de').latest).toMatchObject({
      status: 'ok',
      price: 949,
      shipping: 9.22,
      deliveredPrice: 958.22,
      deliveryLocation: 'Portugal',
      deliveryLocationSource: 'ip',
      variantLabel: 'M1 Pro-125H 32/1TB',
      seller: 'MICRO COMPUTER (HK) TECH LIMITED',
      shipsFrom: 'Amazon',
      inStock: true,
    });
    expect(listingFor(p, 'amazon.es').latest).toMatchObject({ status: 'ok', headlinePrice: 964.69, shipping: 0 });
    expect(listingFor(p, 'amazon.se').latest).toMatchObject({
      status: 'unavailable',
      price: null,
      deliveryLocation: "Sweden (Amazon's default; no location set)",
      deliveryLocationSource: null,
    });

    expect(gotify.map((m) => m.title).sort()).toEqual(['Price drop: Minisforum M1 Pro-125H 32GB/1TB', 'Target price reached: Minisforum M1 Pro-125H 32GB/1TB']);
    expect(gotify.find((m) => m.title.startsWith('Price drop'))!.message).toBe(
      '€958.22 at Amazon Germany (incl. €9.22 delivery)\nhttps://www.amazon.de/dp/B0FH6K3HVC\nWas €964.69',
    );
    expect(p.alertRules.every((r) => r.lastTriggeredAt)).toBe(true);
    expect(await dailySummaryText(db, catalog.get())).toBe('• Minisforum M1 Pro-125H 32GB/1TB: €958.22 at Amazon Germany');
  });

  it('flags a page that is no longer the wanted version, and falls back to the next store', async () => {
    const before = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    const de = listingFor(before, 'amazon.de');
    pages.set(de.url, { status: 200, body: amazonFixture('de-in-stock-delivery-fee').replaceAll('M1 Pro-125H 32/1TB', 'M1 Pro-125H 0/0 GB') });
    const sent = gotify.length;
    await runCheck(de.id);

    const p = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    expect(listingFor(p, 'amazon.de').latest).toMatchObject({ status: 'variant_mismatch', error: 'Not the expected version: contains "0/0"' });
    expect(listingFor(p, 'amazon.de').lastOk).toMatchObject({ headlinePrice: 958.22 });
    expect(p.best).toMatchObject({ marketplace: 'amazon.es', headlinePrice: 964.69 });
    expect(p.issueCount).toBe(1);
    expect(gotify).toHaveLength(sent); // the price went up: no alert
  });

  it('pauses Amazon after a captcha, counts requests, and resumes on request', async () => {
    const before = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    const es = listingFor(before, 'amazon.es');
    pages.set(es.url, { status: 503, body: '<html><form action="/errors/validateCaptcha"></form></html>' });
    await runCheck(es.id);

    const p = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    expect(listingFor(p, 'amazon.es').latest?.status).toBe('captcha');
    expect(p.best).toMatchObject({ marketplace: 'amazon.es', headlinePrice: 964.69 }); // a failed check doesn't hide the last price
    expect(gotify.at(-1)).toMatchObject({ title: 'Amazon and Amazon Business: checks paused', priority: 7 });
    expect(gotify.at(-1)!.message).toMatch(/^amazon\.es showed a captcha\. Checks are paused for 2 h/);

    const stores = (await api<RateGroupStatus[]>('GET', '/api/stores')).body;
    const amazon = stores.find((s) => s.group === 'amazon')!;
    expect(amazon).toMatchObject({ enabledListings: 3, plannedPerHour: 1, level: 'ok', pauseReason: 'amazon.es showed a captcha' });
    expect(amazon.pausedUntil).not.toBeNull();
    expect(amazon.actualLastHour).toEqual({ total: 5, byStatus: { ok: 2, unavailable: 1, variant_mismatch: 1, captcha: 1 } });

    const resumed = (await api<RateGroupStatus[]>('POST', '/api/stores/amazon/resume')).body;
    expect(resumed.find((s) => s.group === 'amazon')!.pausedUntil).toBeNull();
  });

  it('keeps the price history per listing', async () => {
    const h = (await api('GET', `/api/products/${productId}/history?days=7`)).body;
    expect(h.listings.map((l: any) => [l.marketplace, l.points.map((pt: any) => pt.status)])).toEqual([
      ['amazon.de', ['ok', 'variant_mismatch']],
      ['amazon.es', ['ok', 'captcha']],
      ['amazon.se', ['unavailable']],
    ]);
    // Only valid checks carry a price: the wrong-version page's price is left out of the chart
    expect(h.listings[0].points.map((pt: any) => pt.headlineEur)).toEqual([958.22, null]);
  });

  it('edits listings within the limits', async () => {
    const p = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    const de = listingFor(p, 'amazon.de');
    expect((await api('PATCH', `/api/listings/${de.id}`, { intervalMinutes: 20 })).status).toBe(400);
    const edited = await api<ProductDetail>('PATCH', `/api/listings/${de.id}`, { intervalMinutes: 60, guardExclude: ['barebone'] });
    expect(listingFor(edited.body, 'amazon.de')).toMatchObject({ intervalMinutes: 60, guardExclude: ['barebone'] });
    const planned = (await api<RateGroupStatus[]>('GET', '/api/stores')).body.find((s) => s.group === 'amazon')!.plannedPerHour;
    expect(planned).toBeCloseTo(1 / 3 + 1 / 3 + 1, 2);

    const queued = await api<ProductDetail>('POST', `/api/listings/${de.id}/check`);
    expect(Date.now() - Date.parse(listingFor(queued.body, 'amazon.de').nextCheckAt!)).toBeLessThan(5000);
    const disabled = await api<ProductDetail>('PATCH', `/api/listings/${de.id}`, { enabled: false });
    expect(listingFor(disabled.body, 'amazon.de').nextCheckAt).toBeNull();
    expect((await api('POST', `/api/listings/${de.id}/check`)).status).toBe(409);
  });

  it('adds a shop from a product link: one preview request, which becomes the first check', async () => {
    const RP = 'https://www.radiopopular.pt/produto/smartphone-samsung-galaxy-a17-256gb-preto';
    pages.set(RP, { status: 200, body: shopFixture('radiopopular-in-stock') });
    const product = (await api<ProductDetail>('POST', '/api/products', { name: 'Galaxy A17 256GB black' })).body;

    expect((await api('POST', '/api/listings/parse-url', { url: `${RP}?utm_source=newsletter` })).body).toEqual({ kind: 'unknown', host: 'www.radiopopular.pt', url: RP });
    const before = fetches;
    const preview = await api<StorePreview>('POST', '/api/custom-stores/preview', { url: RP });
    expect(preview.body).toMatchObject({
      trackable: true,
      storeId: 'radiopopular.pt',
      suggestedLabel: 'Radio Popular',
      dataSource: 'microdata',
      status: 'ok',
      title: 'SMARTPHONE SAMSUNG GALAXY A17 256GB PRETO',
      price: 259.99,
      currency: 'EUR',
      inStock: true,
      protection: null,
    });
    expect(fetches).toBe(before + 1);
    expect((await api('POST', '/api/custom-stores/preview', { url: RP })).status).toBe(429); // one per shop every 10 s
    // A selector test right after the preview reads the preview's copy of the page: no request, no wait
    const selectorTest = await api<SelectorTest>('POST', '/api/custom-stores/test-selector', { url: RP, selector: '[itemprop="price"]' });
    expect(selectorTest.body).toMatchObject({ worksWithoutBrowser: true, fetchMethod: 'http', price: 259.99 });
    expect(fetches).toBe(before + 1);

    const created = await api<Catalog>('POST', '/api/custom-stores', { host: 'www.radiopopular.pt', label: 'Radio Popular' });
    expect(created.body.stores.find((s) => s.id === 'radiopopular.pt')).toMatchObject({ custom: true, implemented: true, defaultIntervalMinutes: 180 });
    expect((await api('POST', '/api/custom-stores', { host: 'radiopopular.pt', label: 'Again' })).status).toBe(409);
    expect((await api('POST', '/api/custom-stores', { host: 'www.amazon.com', label: 'Amazon US' })).status).toBe(422);

    expect((await api('POST', '/api/listings/parse-url', { url: RP })).body).toMatchObject({ kind: 'known', store: 'radiopopular.pt' });
    const withListing = await api<ProductDetail>('POST', `/api/products/${product.id}/listings`, {
      store: 'radiopopular.pt',
      externalId: '/produto/smartphone-samsung-galaxy-a17-256gb-preto',
      marketplaces: ['radiopopular.pt'],
    });
    expect(withListing.status).toBe(201);
    const listing = withListing.body.listings[0]!;
    expect(listing).toMatchObject({ url: RP, intervalMinutes: 180 });
    expect(listing.latest).toMatchObject({ status: 'ok', headlinePrice: 259.99, inStock: true });
    expect(withListing.body.best).toMatchObject({ store: 'radiopopular.pt', headlinePrice: 259.99 });
    expect(fetches).toBe(before + 1); // the preview was the first check: no second request
    expect(Date.parse(listing.nextCheckAt!) - Date.now()).toBeGreaterThan(2.5 * 60 * 60 * 1000);

    await runCheck(listing.id);
    expect(fetches).toBe(before + 2);

    // The new store's icon, from the page its preview loaded (the fake loader stands in for the icon request)
    await expect.poll(async () => (await api<Record<string, string>>('GET', '/api/store-icons')).body['radiopopular.pt']).toBeDefined();
    const icon = await fetch(`${base}/api/store-icons/radiopopular.pt`, { headers: { cookie } });
    expect(icon.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await icon.arrayBuffer())).toEqual(PNG);
    expect(iconRequests.filter((u) => u.includes('radiopopular'))).toHaveLength(1);

    const group = (await api<RateGroupStatus[]>('GET', '/api/stores')).body.find((g) => g.group === 'radiopopular.pt');
    expect(group).toMatchObject({ label: 'Radio Popular', custom: true, enabledListings: 1, warnPerHour: 10, actualLastHour: { total: 2 } });

    const renamed = await api<Catalog>('PATCH', '/api/custom-stores/radiopopular.pt', { label: 'Rádio Popular', defaultIntervalMinutes: 360 });
    expect(renamed.body.marketplaces.find((m) => m.id === 'radiopopular.pt')).toMatchObject({ label: 'Rádio Popular', host: 'www.radiopopular.pt', country: 'PT' });
    expect((await api('DELETE', '/api/custom-stores/radiopopular.pt')).status).toBe(409); // still has a listing
    await api('DELETE', `/api/listings/${listing.id}`);
    const deleted = await api<Catalog>('DELETE', '/api/custom-stores/radiopopular.pt');
    expect(deleted.body.stores.some((s) => s.id === 'radiopopular.pt')).toBe(false);
    expect((await api<Record<string, string>>('GET', '/api/store-icons')).body['radiopopular.pt']).toBeUndefined();
  });

  it("previews say which shops block automated checks, and which have nothing to read", async () => {
    const WORTEN = 'https://www.worten.pt/produtos/smartphone-google-pixel-10-pro-6-3-16-gb-256-gb-obsidian-8525040';
    pages.set(WORTEN, { status: 403, body: shopFixture('cloudflare-challenge'), headers: { 'cf-mitigated': 'challenge' } });
    expect((await api('POST', '/api/custom-stores/preview', { url: WORTEN })).body).toMatchObject({
      trackable: false,
      protection: 'Cloudflare challenge',
      status: 'blocked',
      suggestedLabel: 'Worten',
    });

    const FNAC = 'https://www.fnac.pt/Google-Pixel-10-Pro-256GB-Obsidiana-Telemovel-SmartPhone-Android/a13213894';
    pages.set(FNAC, { status: 200, body: shopFixture('fnac-out-of-stock') });
    expect((await api('POST', '/api/custom-stores/preview', { url: FNAC })).body).toMatchObject({
      trackable: true,
      dataSource: 'json-ld',
      status: 'unavailable',
      price: 829,
      inStock: false,
      seller: 'Fnac.pt',
      gtin: '0840353925380',
    });

    pages.set('https://shop.example.pt/p/1', { status: 200, body: '<html><title>Nothing here</title></html>' });
    const empty = (await api<StorePreview>('POST', '/api/custom-stores/preview', { url: 'https://shop.example.pt/p/1' })).body;
    expect(empty).toMatchObject({ trackable: false, dataSource: null, status: 'error' });
    expect(empty.error).toMatch(/No product data/);

    expect((await api('POST', '/api/custom-stores/preview', { url: 'https://www.amazon.com/dp/B0FH6K3HVC' })).status).toBe(422);
  });

  it.skipIf(!process.env.PLAYWRIGHT_BROWSERS_PATH)('streams the live browser over a WebSocket, to signed-in same-origin clients only', async () => {
    expect((await api('POST', '/api/browser/sessions', { url: 'http://192.168.1.1/' })).status).toBe(422);
    setAllowPrivateHosts(true); // the page shown is this test server's own
    try {
      const created = await api<{ id: string }>('POST', '/api/browser/sessions', { url: `${base}/api/health` });
      expect(created.status).toBe(201);
      const url = `${base.replace(/^http/, 'ws')}/api/browser/live?id=${created.body.id}`;

      const ws = new WebSocket(url, { headers: { cookie, origin: base } });
      const frame = await new Promise<any>((resolve, reject) => {
        ws.on('message', (d) => {
          const m = JSON.parse(String(d));
          if (m.t === 'frame') resolve(m);
        });
        ws.on('error', reject);
      });
      expect(frame).toMatchObject({ t: 'frame', w: 1280, h: 800, data: expect.any(String) });
      ws.close();

      const refused = (headers: Record<string, string>) =>
        new Promise<number>((resolve) => {
          const other = new WebSocket(url, { headers });
          other.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
          other.on('error', () => {});
        });
      expect(await refused({ cookie, origin: 'https://elsewhere.example' })).toBe(403);
      expect(await refused({ origin: base })).toBe(401);

      expect((await api('DELETE', `/api/browser/sessions/${created.body.id}`)).body).toEqual({ ok: true });
    } finally {
      setAllowPrivateHosts(false);
    }
  });

  it('checks with a signed-in Amazon session, keeps renewed cookies, and expires it when Amazon signs it out', async () => {
    const sessions = (await api<StoreSessionStatus[]>('GET', '/api/store-sessions')).body;
    expect(sessions.filter((s) => s.store === 'amazon').map((s) => s.marketplace)).toEqual([
      'amazon.de',
      'amazon.fr',
      'amazon.it',
      'amazon.es',
      'amazon.nl',
      'amazon.com.be',
      'amazon.ie',
      'amazon.se',
      'amazon.pl',
    ]);
    expect(sessions.every((s) => s.status === 'none')).toBe(true);
    expect((await api('POST', '/api/store-sessions/sign-in', { store: 'radiopopular.pt', marketplace: 'radiopopular.pt' })).status).toBe(422);

    // As if signed in through the live browser
    await storeSessions.save(
      'amazon',
      'amazon.es',
      {
        cookies: [
          { name: 'session-id', value: 's1', domain: '.amazon.es', path: '/', expires: 2_000_000_000, httpOnly: false, secure: true, sameSite: 'Lax' },
          { name: 'session-token', value: 'old', domain: '.amazon.es', path: '/', expires: 2_000_000_000, httpOnly: true, secure: true, sameSite: 'Lax' },
        ],
        origins: [],
      },
      'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/147.0.0.0',
      'Gil',
    );
    expect((await api<StoreSessionStatus[]>('GET', '/api/store-sessions')).body.find((s) => s.marketplace === 'amazon.es')).toMatchObject({
      status: 'active',
      accountName: 'Gil',
    });

    const p = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    const es = listingFor(p, 'amazon.es');
    pages.set(es.url, { status: 200, body: signedInAmazonPage(amazonFixture('es-in-stock-free-delivery'), 'Gil', 'Lisboa 1000-001') });
    onSessionFetch = async (url, jar) => {
      await jar.setCookie('session-token=renewed; Domain=.amazon.es; Path=/; Secure; HttpOnly', url);
    };
    await runCheck(es.id);
    expect(lastSession).toEqual({ cookies: 'session-id=s1; session-token=old', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/147.0.0.0' });
    let latest = listingFor((await api<ProductDetail>('GET', `/api/products/${productId}`)).body, 'amazon.es').latest!;
    expect(latest).toMatchObject({ status: 'ok', signedIn: true, deliveryLocation: 'Lisboa 1000-001', deliveryLocationSource: 'account' });
    expect((await storeSessions.state('amazon', 'amazon.es'))!.cookies.find((c) => c.name === 'session-token')!.value).toBe('renewed');

    // Amazon no longer accepts it: the page comes back signed out
    onSessionFetch = null;
    pages.set(es.url, { status: 200, body: amazonFixture('es-in-stock-free-delivery') });
    const sent = gotify.length;
    await runCheck(es.id);
    expect(lastSession!.cookies).toContain('session-token=renewed');
    latest = listingFor((await api<ProductDetail>('GET', `/api/products/${productId}`)).body, 'amazon.es').latest!;
    expect(latest).toMatchObject({ status: 'ok', signedIn: false, deliveryLocationSource: 'ip' });
    expect(gotify.slice(sent).map((m) => m.title)).toContain('Amazon Spain: signed out');
    expect((await api<StoreSessionStatus[]>('GET', '/api/store-sessions')).body.find((s) => s.marketplace === 'amazon.es')).toMatchObject({
      status: 'expired',
      expiredAt: expect.any(String),
    });

    // Expired: the next check goes without it, and no second notification
    const sentAfter = gotify.length;
    await runCheck(es.id);
    expect(lastSession).toBeNull();
    expect(gotify.length).toBe(sentAfter);

    const removed = (await api<StoreSessionStatus[]>('DELETE', '/api/store-sessions/amazon/amazon.es')).body;
    expect(removed.find((s) => s.marketplace === 'amazon.es')!.status).toBe('none');
  });

  it.skipIf(!process.env.PLAYWRIGHT_BROWSERS_PATH)('keeps a sign-in from the live browser only once the page shows it signed in', async () => {
    // A stand-in for Amazon's home page: it sets a cookie, and is signed out until /signed-in
    const page = (signedIn: boolean) =>
      `<!doctype html><html><head><meta charset="utf-8"><title>Amazon</title></head><body><div id="nav-link-accountList"><a href="${
        signedIn ? '/gp/css/homepage.html' : '/ap/signin?x=1'
      }" data-csa-c-slot-id="nav-link-accountList"><span id="nav-link-accountList-nav-line-1">${
        signedIn ? 'Olá, Gil' : 'Olá, inicie sessão'
      }</span></a></div></body></html>`;
    // Amazon takes the sign-in on amazon.de and amazon.fr, not on amazon.it
    const signedInUrls = ['/signed-in', '/home/amazon.de', '/home/amazon.fr'];
    const fake = http.createServer((req, res) =>
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'session-id=fromlogin; Path=/' })
        .end(page(signedInUrls.includes(req.url ?? ''))),
    );
    const fakeBase = await listen(fake);
    homeBase = fakeBase;
    setAllowPrivateHosts(true);
    try {
      const live = await liveSessions.open(`${fakeBase}/`, 'pt-PT', { purpose: { kind: 'sign-in', store: 'amazon', marketplace: 'amazon.es' } });
      await live.currentPage.waitForSelector('#nav-link-accountList');
      const notYet = await api('POST', '/api/store-sessions/save', { store: 'amazon', marketplace: 'amazon.es', liveSessionId: live.id });
      expect(notYet.status).toBe(409);
      expect(notYet.body.error).toMatch(/doesn't show you as signed in yet/);
      // Purpose must match
      expect((await api('POST', '/api/store-sessions/save', { store: 'amazon', marketplace: 'amazon.de', liveSessionId: live.id })).status).toBe(404);

      await live.currentPage.goto(`${fakeBase}/signed-in`);
      const saved = await api<SignInResult>('POST', '/api/store-sessions/save', { store: 'amazon', marketplace: 'amazon.es', liveSessionId: live.id });
      expect(saved.status).toBe(200);
      expect(saved.body.sessions.find((s) => s.marketplace === 'amazon.es')).toMatchObject({ status: 'active', accountName: 'Gil' });
      // The same sign-in, checked on the other stores: saved where Amazon took it, stopping at the first that didn't
      expect(saved.body.alsoSignedIn).toEqual(['amazon.de', 'amazon.fr']);
      expect(saved.body.checked).toEqual(['amazon.de', 'amazon.fr', 'amazon.it']);
      expect(saved.body.sessions.filter((s) => s.store === 'amazon' && s.status === 'active').map((s) => s.marketplace).sort()).toEqual([
        'amazon.de',
        'amazon.es',
        'amazon.fr',
      ]);
      const state = (await storeSessions.state('amazon', 'amazon.es'))!;
      expect(state.cookies.map((c) => `${c.name}=${c.value}`)).toContain('session-id=fromlogin');
      expect(liveSessions.get(live.id)).toBeUndefined(); // closed after saving
    } finally {
      setAllowPrivateHosts(false);
      fake.close();
      for (const m of ['amazon.es', 'amazon.de', 'amazon.fr']) await storeSessions.remove('amazon', m);
    }
  });

  it('checks Amazon Business only with a business sign-in, and counts its price without VAT as it is', async () => {
    const sessions = (await api<StoreSessionStatus[]>('GET', '/api/store-sessions')).body;
    expect(sessions.filter((s) => s.store === 'amazon-business').map((s) => s.marketplace)).toEqual([
      'business.amazon.de',
      'business.amazon.fr',
      'business.amazon.it',
      'business.amazon.es',
    ]);

    const added = await api<ProductDetail>('POST', `/api/products/${productId}/listings`, {
      store: 'amazon-business',
      externalId: 'B0FH6K3HVC',
      marketplaces: ['business.amazon.de'],
    });
    expect(added.status).toBe(201);
    const listing = added.body.listings.find((l) => l.store === 'amazon-business')!;
    expect(listing).toMatchObject({ marketplace: 'business.amazon.de', url: 'https://www.amazon.de/dp/B0FH6K3HVC' });
    // The sign-in list says which stores have listings (the ones a sign-in is needed for)
    const withCount = (await api<StoreSessionStatus[]>('GET', '/api/store-sessions')).body.find((s) => s.marketplace === 'business.amazon.de');
    expect(withCount).toMatchObject({ status: 'none', listingCount: 1 });
    const bestBefore = added.body.best;

    // Not signed in: nothing to check, no request
    const before = fetches;
    await runCheck(listing.id);
    expect(fetches).toBe(before);
    let p = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    expect(p.listings.find((l) => l.id === listing.id)!.latest).toMatchObject({ status: 'signed_out', price: null });
    expect(p.best).toEqual(bestBefore);

    // Signed in with the business account: the page states both prices; the one without VAT counts as it is
    await storeSessions.save('amazon-business', 'business.amazon.de', { cookies: [], origins: [] }, 'Mozilla/5.0 HeadlessChrome/147', 'Gil Lda');
    signedInPages.set(listing.url, { status: 200, body: amazonFixture('business-es-vat-both') });
    await runCheck(listing.id);
    p = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    expect(p.listings.find((l) => l.id === listing.id)!.latest).toMatchObject({
      status: 'ok',
      signedIn: true,
      priceIncludesVat: false,
      price: 794.12,
      priceInclVat: 945,
      shipping: 0,
      headlinePrice: 794.12,
      headlineEur: 794.12,
      deliveryLocationSource: 'account',
    });
    // The lowest price the product has, so it's the best one, marked as without VAT
    expect(bestBefore!.headlineEur).toBeGreaterThan(794.12);
    expect(p.best).toMatchObject({ listingId: listing.id, headlinePrice: 794.12, priceIncludesVat: false });

    // The sign-in lapses: what comes back is Amazon's ordinary page, not a business price
    signedInPages.set(listing.url, { status: 200, body: amazonFixture('de-in-stock-delivery-fee') });
    const sent = gotify.length;
    await runCheck(listing.id);
    p = (await api<ProductDetail>('GET', `/api/products/${productId}`)).body;
    expect(p.listings.find((l) => l.id === listing.id)!.latest).toMatchObject({ status: 'signed_out', signedIn: false });
    expect(gotify.slice(sent).map((m) => m.title)).toContain('Amazon Business Germany: signed out');
    expect(p.issueCount).toBeGreaterThan(0);

    const after = fetches;
    await runCheck(listing.id);
    expect(fetches).toBe(after); // expired: no request until signed in again

    await api('DELETE', `/api/listings/${listing.id}`);
    await storeSessions.remove('amazon-business', 'business.amazon.de');
  });

  it('updates settings', async () => {
    const s = await api('PATCH', '/api/settings', { dailySummaryHour: 9 });
    expect(s.body).toMatchObject({ dailySummaryEnabled: true, dailySummaryHour: 9, timeZone: expect.any(String) });
    expect((await api('PATCH', '/api/settings', { dailySummaryHour: 24 })).status).toBe(400);
  });

  it('signs everyone out on a password reset, keeping the tracking data', async () => {
    await resetPassword(db, 'a brand new password');
    expect((await api('GET', '/api/products')).status).toBe(401);
    expect((await api('POST', '/api/auth/login', { password: 'correct horse' })).status).toBe(401);
    expect((await api('POST', '/api/auth/login', { password: 'a brand new password' })).body).toEqual({ setupRequired: false, authenticated: true });
    expect((await api<ProductDetail>('GET', `/api/products/${productId}`)).body.listings).toHaveLength(3);
  });

  it('survives Postgres dropping its connections', async () => {
    expect((await api('GET', '/api/health')).status).toBe(200); // leaves idle connections in the pool
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [TEST_DB]);
    await admin.end();
    await new Promise((r) => setTimeout(r, 200));
    expect((await api('GET', '/api/health')).status).toBe(200);
  });

  it('answers unknown API routes and cross-site writes with errors', async () => {
    expect(await api('GET', '/api/nope')).toEqual({ status: 404, body: { error: 'No such API route' } });
    const res = await fetch(`${base}/api/products`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{"name":"x"}' });
    expect(res.status).toBe(403);
  });
});
