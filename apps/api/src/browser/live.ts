// The live browser: a Chromium page on the server, streamed to the web UI as JPEG frames (CDP
// screencast), with the UI's mouse, wheel and keyboard input replayed into it. Used to pick a shop's
// price element (and later, to sign in to stores).
import { randomUUID } from 'node:crypto';
import type { CDPSession, Page } from 'playwright-core';
import type { LiveClientMessage, LiveServerMessage } from '@price-tracker/shared';
import { log } from '../log.ts';
import { parseAmount } from '../pricing/money.ts';
import { isPrivateHost } from '../stores/private-hosts.ts';
import type { BrowserState } from '../stores/sessions.ts';
import type { BrowserManager, LeasedContext } from './manager.ts';
import { PICKER_SCRIPT } from './picker-script.ts';

type Send = (message: LiveServerMessage) => void;

/** What a live session was opened for: browsing (picking a price), or signing in to a store's marketplace. */
export type LivePurpose = { kind: 'browse' } | { kind: 'sign-in'; store: string; marketplace: string };

export interface LiveOpenOptions {
  /** Start from a saved sign-in, so the store recognises the device. */
  storageState?: BrowserState;
  purpose?: LivePurpose;
}

const IDLE_MS = 3 * 60 * 1000; // no one watching
const UNUSED_MS = 15 * 60 * 1000; // watched, but no input
const MAX_AGE_MS = 30 * 60 * 1000;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/** "fnac.pt/x" -> "https://fnac.pt/x"; null for non-web or local addresses. */
export function liveUrl(raw: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    return /^https?:$/.test(url.protocol) && !isPrivateHost(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export class LiveSession {
  readonly id = randomUUID();
  readonly createdAt = Date.now();
  lastActivity = Date.now();
  private page!: Page;
  private cdp: CDPSession | null = null;
  private send: Send | null = null;
  private picking = false;
  private viewport = { width: 1280, height: 800 };
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(
    private leased: LeasedContext,
    private onClosed: (session: LiveSession) => void,
    readonly purpose: LivePurpose,
  ) {}

  static async open(
    manager: BrowserManager,
    url: string,
    locale: string,
    onClosed: (session: LiveSession) => void,
    { storageState, purpose = { kind: 'browse' } }: LiveOpenOptions = {},
  ): Promise<LiveSession> {
    const leased = await manager.context({ viewport: { width: 1280, height: 800 }, locale, storageState });
    const session = new LiveSession(leased, onClosed, purpose);
    try {
      await leased.context.exposeBinding('__ptPicked', (_source, payload: { selector: string; text: string }) => session.picked(payload));
      session.page = await leased.context.newPage();
      session.watch(session.page);
      // Don't wait for the page: the first frames show it loading
      void session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((err) => session.error(err));
      return session;
    } catch (err) {
      await leased.release();
      throw err;
    }
  }

  get hasViewer(): boolean {
    return this.send !== null;
  }

  /** The page's HTML as it is now. */
  html(): Promise<string> {
    return this.page.content();
  }

  /** Cookies and local storage, to keep a sign-in. */
  async browserState(): Promise<BrowserState> {
    return (await this.leased.context.storageState()) as BrowserState;
  }

  /** The browser's own user agent: checks with this sign-in send the same one. */
  userAgent(): Promise<string> {
    return this.page.evaluate('navigator.userAgent') as Promise<string>;
  }

  /** Loads a page in the background, in this session's browser (same cookies), without changing the live view. */
  async peek(url: string): Promise<string> {
    const page = await this.leased.context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      return await page.content();
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Follows a link once it's on the page (e.g. straight to a store's sign-in form). Does nothing if it never shows up. */
  followLink(selector: string): void {
    this.enqueue(async () => {
      const href = await this.page
        .waitForSelector(selector, { timeout: 20_000 })
        .then((el) => el.getAttribute('href'))
        .catch(() => null);
      if (href) await this.page.goto(new URL(href, this.page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    });
  }

  /** For tests: the page being streamed. */
  get currentPage(): Page {
    return this.page;
  }

  private watch(page: Page): void {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) void this.state(true);
    });
    page.on('load', () => void this.state(false));
    page.on('domcontentloaded', () => {
      if (this.picking) void this.applyPicker();
    });
    page.on('dialog', (d) => void d.dismiss().catch(() => {}));
    // Links that open a new tab: follow them in this page instead
    page.on('popup', async (popup) => {
      await popup.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
      const url = popup.url();
      await popup.close().catch(() => {});
      if (url && url !== 'about:blank') this.enqueue(() => page.goto(url, { waitUntil: 'domcontentloaded' }));
    });
  }

  private emit(message: LiveServerMessage): void {
    this.send?.(message);
  }

  private error(err: unknown): void {
    const message = err instanceof Error ? err.message.split('\n')[0]! : String(err);
    this.emit({ t: 'error', message: message.includes('ERR_BLOCKED_BY_CLIENT') ? 'Local and private addresses are blocked' : message });
  }

  private async state(loading: boolean): Promise<void> {
    if (this.closed) return;
    const title = await this.page.title().catch(() => '');
    this.emit({ t: 'state', url: this.page.url(), title, loading });
  }

  private async picked(payload: { selector: string; text: string }): Promise<void> {
    this.lastActivity = Date.now();
    this.emit({ t: 'picked', selector: payload.selector, text: payload.text, price: parseAmount(payload.text) });
  }

  private async applyPicker(): Promise<void> {
    try {
      await this.page.evaluate(PICKER_SCRIPT);
      await this.page.evaluate(this.picking ? 'window.__ptPicker.enable()' : 'window.__ptPicker && window.__ptPicker.disable()');
    } catch {
      // the page navigated meanwhile; domcontentloaded re-applies it
    }
  }

  private async startScreencast(): Promise<void> {
    if (!this.cdp) {
      this.cdp = await this.leased.context.newCDPSession(this.page);
      this.cdp.on('Page.screencastFrame', (frame) => {
        this.emit({ t: 'frame', data: frame.data, w: frame.metadata.deviceWidth, h: frame.metadata.deviceHeight });
        void this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
      });
    }
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: this.viewport.width, maxHeight: this.viewport.height, everyNthFrame: 1 });
  }

  private async stopScreencast(): Promise<void> {
    await this.cdp?.send('Page.stopScreencast').catch(() => {});
  }

  /** A viewer connected: stream to it. One viewer at a time; a new one replaces the old. */
  attach(send: Send): void {
    this.send = send;
    this.lastActivity = Date.now();
    this.enqueue(async () => {
      await this.startScreencast();
      await this.state(false);
    });
  }

  detach(send: Send): void {
    if (this.send !== send) return;
    this.send = null;
    this.lastActivity = Date.now();
    this.enqueue(() => this.stopScreencast());
  }

  /** Input is replayed in order. */
  input(message: LiveClientMessage): void {
    this.lastActivity = Date.now();
    this.enqueue(() => this.handle(message));
  }

  private enqueue(task: () => Promise<unknown>): void {
    this.queue = this.queue.then(() => (this.closed ? undefined : task())).catch((err) => this.error(err));
  }

  private async handle(m: LiveClientMessage): Promise<void> {
    const page = this.page;
    switch (m.t) {
      case 'viewport':
        this.viewport = { width: clamp(m.width, 320, 1600), height: clamp(m.height, 300, 1600) };
        await page.setViewportSize(this.viewport);
        if (this.send) await this.startScreencast();
        return;
      case 'mouse': {
        const x = clamp(m.x, 0, this.viewport.width);
        const y = clamp(m.y, 0, this.viewport.height);
        await page.mouse.move(x, y);
        const options = { button: m.button ?? 'left', clickCount: m.clickCount ?? 1 } as const;
        if (m.type === 'down') await page.mouse.down(options);
        else if (m.type === 'up') await page.mouse.up(options);
        return;
      }
      case 'wheel':
        await page.mouse.move(clamp(m.x, 0, this.viewport.width), clamp(m.y, 0, this.viewport.height));
        await page.mouse.wheel(clamp(m.dx, -2000, 2000), clamp(m.dy, -2000, 2000));
        return;
      case 'key':
        if (m.type === 'down') {
          // Keys Playwright doesn't know (e.g. "ç" on a Portuguese keyboard) are typed as text
          await page.keyboard.down(m.key).catch(async () => {
            if (m.text) await page.keyboard.insertText(m.text);
          });
        } else {
          await page.keyboard.up(m.key).catch(() => {});
        }
        return;
      case 'text':
        await page.keyboard.insertText(m.text.slice(0, 2000));
        return;
      case 'nav':
        if (m.action === 'back') await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
        else if (m.action === 'forward') await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => null);
        else if (m.action === 'reload') await page.reload({ waitUntil: 'domcontentloaded' });
        else {
          const url = liveUrl(m.url ?? '');
          if (!url) {
            this.emit({ t: 'error', message: "That isn't a public web address" });
            return;
          }
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        }
        return;
      case 'pick':
        this.picking = m.on;
        await this.applyPicker();
        return;
      case 'pickParent':
        await page.evaluate('window.__ptPicker && window.__ptPicker.parent()');
        return;
    }
  }

  async close(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.emit({ t: 'closed', reason });
    this.send = null;
    await this.leased.release();
    this.onClosed(this);
    log.info('live browser closed', { reason });
  }
}

/**
 * The open live sessions. At most one: it's a single-user app on a small server, and a forgotten
 * session closes itself after a few minutes without a viewer.
 */
export class LiveSessions {
  private sessions = new Map<string, LiveSession>();
  private timer: NodeJS.Timeout;

  constructor(private manager: BrowserManager) {
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref();
  }

  async open(url: string, locale: string, options: LiveOpenOptions = {}): Promise<LiveSession> {
    for (const s of this.sessions.values()) await s.close('A new browser view was opened');
    const session = await LiveSession.open(this.manager, url, locale, (s) => this.sessions.delete(s.id), options);
    this.sessions.set(session.id, session);
    log.info('live browser opened', { url });
    return session;
  }

  get(id: string | null): LiveSession | undefined {
    return id ? this.sessions.get(id) : undefined;
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (now - s.createdAt > MAX_AGE_MS) await s.close('The browser view closes after 30 minutes');
      else if (now - s.lastActivity > (s.hasViewer ? UNUSED_MS : IDLE_MS)) await s.close('Closed after a while without use');
    }
  }

  async closeAll(): Promise<void> {
    clearInterval(this.timer);
    for (const s of this.sessions.values()) await s.close('The server is stopping');
  }
}
