// The live browser and browser checks, in real Chromium against a local fake shop. Skipped when the
// dev shell's Chromium (PLAYWRIGHT_BROWSERS_PATH) isn't available.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILT_IN_CATALOG } from '@price-tracker/shared';
import type { LiveServerMessage, MarketplaceInfo } from '@price-tracker/shared';
import { createBrowserFetcher, createFetcher } from '../src/browser/fetcher.ts';
import { LiveSessions, liveUrl } from '../src/browser/live.ts';
import type { LiveSession } from '../src/browser/live.ts';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserManager, chromiumTmpDir } from '../src/browser/manager.ts';
import { genericAdapter } from '../src/stores/generic/adapter.ts';
import { createHttpFetcher } from '../src/stores/http.ts';
import { Previewer } from '../src/stores/preview.ts';
import { isPrivateHost, setAllowPrivateHosts } from '../src/stores/private-hosts.ts';
import { parseProductUrl } from '../src/stores/registry.ts';

const hasChromium = !!process.env.PLAYWRIGHT_BROWSERS_PATH;

const PAGES: Record<string, string> = {
  // The price is in the HTML as served, next to another product's price
  '/produto/rato': `<!doctype html><html><head><title>Rato Fantástico</title></head><body style="font:16px sans-serif">
    <h1>Rato Fantástico</h1>
    <div class="buy-box"><span class="label">Preço</span> <span class="price-now">1.299,00 €</span>
      <button onclick="location.href='/carrinho'" style="padding:8px">Comprar</button></div>
    <div class="related"><span class="price-now">9,99 €</span></div></body></html>`,
  // The price only appears once the page's script runs
  '/produto/teclado': `<!doctype html><html><head><title>Teclado</title></head><body style="font:16px sans-serif">
    <div id="app">A carregar…</div>
    <div class="related"><p class="valor">5,00 €</p></div>
    <script>setTimeout(() => { document.getElementById('app').innerHTML = '<div class="product"><p class="valor">49,90 €</p></div>'; }, 100)</script>
    </body></html>`,
  '/carrinho': '<!doctype html><html><body>Carrinho</body></html>',
  '/entrar': '<!doctype html><html><body><input id="email" autofocus style="font-size:20px"></body></html>',
};

async function waitFor<T>(get: () => T | undefined | null | false, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = get();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('private addresses', () => {
  it('blocks loopback, private and local-network hosts', () => {
    setAllowPrivateHosts(false);
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.141', '172.20.1.1', '169.254.1.1', '::1', 'fd00::1', 'nas.local', 'router', 'pi.lan']) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    for (const host of ['www.fnac.pt', '8.8.8.8', '172.32.0.1', 'radiopopular.pt']) expect(isPrivateHost(host), host).toBe(false);
    expect(liveUrl('http://192.168.1.141:8082/')).toBeNull();
    expect(parseProductUrl('http://192.168.1.1/admin', BUILT_IN_CATALOG)).toMatchObject({ kind: 'invalid' });
  });
});

describe.skipIf(!hasChromium)('live browser and browser checks (Chromium)', () => {
  let server: http.Server;
  let base = '';
  const manager = new BrowserManager(500);
  const sessions = new LiveSessions(manager);
  const httpFetcher = createHttpFetcher();
  const previewer = new Previewer(httpFetcher);

  beforeAll(async () => {
    setAllowPrivateHosts(true);
    server = http.createServer((req, res) => {
      const body = PAGES[req.url ?? ''];
      res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(body ?? 'not found');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await sessions.closeAll();
    await manager.shutdown();
    server.close();
    setAllowPrivateHosts(false);
  });

  async function openLive(path: string): Promise<{ session: LiveSession; messages: LiveServerMessage[] }> {
    const session = await sessions.open(base + path, 'pt-PT');
    const messages: LiveServerMessage[] = [];
    session.attach((m) => messages.push(m));
    await waitFor(() => messages.some((m) => m.t === 'frame'));
    return { session, messages };
  }

  async function clickOn(session: LiveSession, selector: string): Promise<void> {
    const box = (await session.currentPage.locator(selector).first().boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    session.input({ t: 'mouse', type: 'move', x, y });
    session.input({ t: 'mouse', type: 'down', x, y });
    session.input({ t: 'mouse', type: 'up', x, y });
  }

  const lastPicked = (messages: LiveServerMessage[]) => {
    const picks = messages.filter((m): m is Extract<LiveServerMessage, { t: 'picked' }> => m.t === 'picked');
    return picks[picks.length - 1];
  };

  it('streams the page, and picking the price gives a selector that works without a browser', async () => {
    const { session, messages } = await openLive('/produto/rato');
    const frame = messages.find((m) => m.t === 'frame')!;
    expect(frame).toMatchObject({ w: 1280, h: 800 });

    session.input({ t: 'pick', on: true });
    await clickOn(session, '.buy-box .price-now');
    const picked = await waitFor(() => lastPicked(messages));
    expect(picked).toMatchObject({ text: '1.299,00 €', price: 1299 });
    // Unique on the page: not the related product's price
    expect(await session.currentPage.locator(picked.selector).count()).toBe(1);

    // In pick mode, clicking a button picks it instead of pressing it
    await clickOn(session, '.buy-box button');
    await waitFor(() => lastPicked(messages)?.text === 'Comprar');
    expect(session.currentPage.url()).toBe(`${base}/produto/rato`);

    // Widening a pick to the parent element
    const before = messages.length;
    session.input({ t: 'pickParent' });
    await waitFor(() => messages.length > before && lastPicked(messages)?.text.startsWith('Preço'));

    const test = await previewer.testSelector(new URL(`${base}/produto/rato`), picked.selector);
    expect(test).toMatchObject({ worksWithoutBrowser: true, fetchMethod: 'http', price: 1299, text: '1.299,00 €', title: 'Rato Fantástico' });
    await session.close('test done');
  });

  it('types pasted text into the focused field', async () => {
    const { session } = await openLive('/entrar');
    await session.currentPage.waitForSelector('#email');
    await clickOn(session, '#email');
    session.input({ t: 'text', text: 'gil@example.com' });
    await expect.poll(() => session.currentPage.inputValue('#email'), { timeout: 5000 }).toBe('gil@example.com');
    await session.close('test done');
  });

  it("a price added by the page's script needs browser checks", async () => {
    const { session, messages } = await openLive('/produto/teclado');
    await session.currentPage.waitForSelector('#app .valor');
    session.input({ t: 'pick', on: true });
    await clickOn(session, '#app .valor');
    const picked = await waitFor(() => lastPicked(messages));
    expect(picked).toMatchObject({ text: '49,90 €', price: 49.9 });
    await session.close('test done');

    const test = await previewer.testSelector(new URL(`${base}/produto/teclado`), picked.selector);
    expect(test).toMatchObject({ worksWithoutBrowser: false, fetchMethod: 'browser', price: null });

    const marketplace: MarketplaceInfo = {
      id: 'loja.pt',
      store: 'loja.pt',
      host: new URL(base).host,
      country: 'PT',
      label: 'Loja',
      currency: 'EUR',
      priceSelector: picked.selector,
      fetchMethod: 'browser',
    };
    const fetchPage = createFetcher(httpFetcher, createBrowserFetcher(manager));
    const out = await genericAdapter.check({ marketplace, externalId: '/produto/teclado', url: `${base}/produto/teclado` }, fetchPage);
    expect(out).toMatchObject({ status: 'ok', price: 49.9, currency: 'EUR', title: 'Teclado' });
  });

  it('starts even when TMPDIR is long (nix develop shells nested in each other)', async () => {
    const nested = path.join(mkdtempSync(path.join(tmpdir(), 'pt-')), 'nix-shell.aaaaaa', 'nix-shell.bbbbbb', 'nix-shell.cccccc', 'nix-shell.dddddd');
    mkdirSync(nested, { recursive: true });
    expect(chromiumTmpDir(nested)).toBe('/tmp');
    expect(chromiumTmpDir('/tmp/nix-shell.abc123')).toBe('/tmp/nix-shell.abc123');
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = nested;
    const fresh = new BrowserManager(100);
    try {
      const { context, release } = await fresh.context();
      const page = await context.newPage();
      await page.goto(`${base}/produto/rato`);
      expect(await page.title()).toBe('Rato Fantástico');
      await release();
    } finally {
      process.env.TMPDIR = saved;
      await fresh.shutdown();
      rmSync(path.dirname(path.dirname(path.dirname(path.dirname(nested)))), { recursive: true, force: true });
    }
  });

  it('refuses local addresses in the browser when they are not allowed', async () => {
    setAllowPrivateHosts(false);
    try {
      const { context, release } = await manager.context();
      const page = await context.newPage();
      await expect(page.goto(`${base}/produto/rato`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
      await release();
    } finally {
      setAllowPrivateHosts(true);
    }
  });
});
