import { CookieJar } from 'tough-cookie';
import type { FetchOptions, PageFetcher, PageResponse } from './types.ts';

// The same browser-like headers the old pccomponentes script sent
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

/**
 * Plain HTTP fetcher. Keeps one anonymous cookie jar per marketplace for the life of the process, so
 * repeated checks look like one returning visitor and the store keeps the same delivery location. A
 * signed-in check brings its own jar (and the user agent of the browser that signed in) instead.
 */
export function createHttpFetcher(): PageFetcher {
  const jars = new Map<string, CookieJar>();

  return async (url: string, { marketplace, acceptLanguage, session }: FetchOptions): Promise<PageResponse> => {
    let jar = session?.jar ?? jars.get(marketplace.id);
    if (!jar) {
      jar = new CookieJar();
      jars.set(marketplace.id, jar);
    }
    const started = Date.now();
    let current = url;
    let requestCount = 0;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const cookie = await jar.getCookieString(current);
      requestCount++;
      const res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'user-agent': session?.userAgent ?? USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'accept-language': acceptLanguage,
          ...(cookie ? { cookie } : {}),
        },
      });
      for (const setCookie of res.headers.getSetCookie()) {
        await jar.setCookie(setCookie, current, { ignoreError: true });
      }
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        current = new URL(location, current).toString();
        continue;
      }
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > MAX_BODY_BYTES) {
        await res.body?.cancel();
        throw new Error(`Response too large (${length} bytes)`);
      }
      const body = await res.text();
      return { status: res.status, url: current, body, requestCount, durationMs: Date.now() - started, headers: Object.fromEntries(res.headers) };
    }
    throw new Error(`More than ${MAX_REDIRECTS} redirects`);
  };
}
