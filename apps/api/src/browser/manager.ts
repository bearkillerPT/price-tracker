// Chromium for the live browser and for checks of shops whose prices are added by scripts. Started on
// first use, shut down a minute after the last user, so the Pi only pays for it while it's needed.
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Route,
} from "playwright-core";
import { log } from "../log.ts";
import { isPrivateHost } from "../stores/private-hosts.ts";

export interface ContextOptions extends BrowserContextOptions {
  /** Don't load images, media and fonts (checks don't need them; the live browser does). */
  blockHeavy?: boolean;
}

export interface LeasedContext {
  context: BrowserContext;
  release: () => Promise<void>;
}

/** Aborts requests to local and private addresses, and optionally heavy resources. */
async function guard(
  context: BrowserContext,
  blockHeavy: boolean,
): Promise<void> {
  await context.route("**/*", (route: Route) => {
    const request = route.request();
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return route.continue();
    }
    if (/^(https?|wss?):$/.test(url.protocol) && isPrivateHost(url.hostname))
      return route.abort("blockedbyclient");
    if (
      blockHeavy &&
      ["image", "media", "font"].includes(request.resourceType())
    )
      return route.abort("blockedbyclient");
    return route.continue();
  });
}

/**
 * The temp folder to give Chromium. It creates a Unix socket in there, and socket paths are limited to 108
 * bytes, so a long TMPDIR (e.g. nix develop shells nested in each other) makes it crash on start with
 * "Target page, context or browser has been closed". Long ones are swapped for /tmp.
 */
export function chromiumTmpDir(current: string = tmpdir()): string {
  return current.length <= 40 || !existsSync("/tmp") ? current : "/tmp";
}

export class BrowserManager {
  private browser: Promise<Browser> | null = null;
  private users = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private idleMs = 60_000) {}

  private start(): Promise<Browser> {
    log.info("starting chromium");
    // Playwright passes --no-sandbox by default, which the systemd service needs (no user namespaces)
    const tmp = chromiumTmpDir();
    return chromium
      .launch({
        channel: "chromium",
        headless: true,
        env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
      })
      .then((b) => {
        b.on("disconnected", () => {
          this.browser = null;
        });
        return b;
      });
  }

  /** A fresh browser context (its own cookies), closed again with release(). */
  async context({
    blockHeavy = false,
    ...options
  }: ContextOptions = {}): Promise<LeasedContext> {
    this.users++;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    try {
      this.browser ??= this.start().catch((err) => {
        this.browser = null;
        throw err;
      });
      const browser = await this.browser;
      const context = await browser.newContext({
        acceptDownloads: false,
        ...options,
      });
      await guard(context, blockHeavy);
      let released = false;
      return {
        context,
        release: async () => {
          if (released) return;
          released = true;
          await context.close().catch(() => {});
          this.done();
        },
      };
    } catch (err) {
      this.done();
      throw new Error(
        `The browser couldn't start: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
    }
  }

  private done(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0 && this.browser)
      this.idleTimer = setTimeout(() => void this.shutdown(), this.idleMs);
  }

  async shutdown(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const browser = this.browser;
    this.browser = null;
    if (browser) {
      log.info("stopping chromium");
      await (await browser.catch(() => null))?.close().catch(() => {});
    }
  }
}
