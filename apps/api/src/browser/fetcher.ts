import type { PageFetcher } from "../stores/types.ts";
import type { BrowserManager } from "./manager.ts";

const GOTO_TIMEOUT_MS = 45_000;
const SETTLE_TIMEOUT_MS = 15_000;

/**
 * Loads the page in Chromium and returns its HTML once the price element is there (or the page has
 * loaded): for shops whose prices are added by the page's scripts. Images, media and fonts are skipped.
 */
export function createBrowserFetcher(manager: BrowserManager): PageFetcher {
  return async (url, { marketplace, acceptLanguage }) => {
    const started = Date.now();
    const { context, release } = await manager.context({
      blockHeavy: true,
      locale: acceptLanguage.split(",")[0],
      extraHTTPHeaders: { "accept-language": acceptLanguage },
      viewport: { width: 1366, height: 900 },
    });
    try {
      const page = await context.newPage();
      const res = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: GOTO_TIMEOUT_MS,
      });
      if (marketplace.priceSelector) {
        await page
          .waitForSelector(marketplace.priceSelector, {
            timeout: SETTLE_TIMEOUT_MS,
          })
          .catch(() => {});
      } else {
        await page
          .waitForLoadState("load", { timeout: SETTLE_TIMEOUT_MS })
          .catch(() => {});
      }
      return {
        status: res?.status() ?? 0,
        url: page.url(),
        body: await page.content(),
        requestCount: 1,
        durationMs: Date.now() - started,
        headers: res ? await res.allHeaders() : {},
      };
    } finally {
      await release();
    }
  };
}

/** Plain HTTP for most marketplaces; Chromium for custom stores set to "browser". */
export function createFetcher(
  http: PageFetcher,
  browser: PageFetcher,
): PageFetcher {
  return (url, options) =>
    (options.marketplace.fetchMethod === "browser" ? browser : http)(
      url,
      options,
    );
}
