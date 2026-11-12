import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_CATALOG, marketplaceIn } from '@price-tracker/shared';
import { open, seal } from '../src/auth/secret-box.ts';
import { amazonAccount, parseAmazonPage } from '../src/stores/amazon/parse.ts';
import { createHttpFetcher } from '../src/stores/http.ts';
import { jarFromState, toBrowserCookie } from '../src/stores/sessions.ts';
import type { BrowserState } from '../src/stores/sessions.ts';
import { amazonFixture, businessAmazonPage, signedInAmazonPage } from './fixtures.ts';

const key = randomBytes(32).toString('base64');

describe('secret box', () => {
  it('round-trips, and refuses a wrong key or changed data', () => {
    const sealed = seal('{"cookies":[]}', key);
    expect(sealed).toMatch(/^v1\./);
    expect(open(sealed, key)).toBe('{"cookies":[]}');
    expect(() => open(sealed, randomBytes(32).toString('base64'))).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => open(parts.join('.'), key)).toThrow();
  });
});

describe('cookies between the browser and the HTTP client', () => {
  const state: BrowserState = {
    cookies: [
      { name: 'session-id', value: '123', domain: '.amazon.es', path: '/', expires: 2_000_000_000, httpOnly: false, secure: true, sameSite: 'Lax' },
      { name: 'at-main', value: 'abc', domain: 'www.amazon.es', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'None' },
    ],
    origins: [],
  };

  it('converts both ways', async () => {
    const { jar, store } = await jarFromState(state);
    expect(await jar.getCookieString('https://www.amazon.es/dp/X')).toBe('session-id=123; at-main=abc');
    expect(await jar.getCookieString('https://smile.amazon.es/')).toBe('session-id=123'); // at-main is host-only
    expect((await store.getAllCookies()).map(toBrowserCookie)).toEqual(state.cookies);
  });

  it('a signed-in fetch sends the session cookies and user agent, and keeps cookies the store renews', async () => {
    const seen: { cookie?: string; ua?: string }[] = [];
    const server = http.createServer((req, res) => {
      seen.push({ cookie: req.headers.cookie, ua: req.headers['user-agent'] });
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'at-main=renewed; Path=/; Secure; HttpOnly' }).end('<html></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dp/X`;
    // Cookies for this test server's host
    const local: BrowserState = { cookies: [{ ...state.cookies[0]!, domain: '127.0.0.1', secure: false }], origins: [] };
    const { jar, store } = await jarFromState(local);
    const fetchPage = createHttpFetcher();
    const marketplace = marketplaceIn(BUILT_IN_CATALOG, 'amazon.es')!;
    await fetchPage(url, { marketplace, acceptLanguage: 'en', session: { jar, userAgent: 'Mozilla/5.0 HeadlessChrome/147' } });
    await fetchPage(url, { marketplace, acceptLanguage: 'en' }); // anonymous: its own jar, the default user agent
    server.close();
    expect(seen[0]).toEqual({ cookie: 'session-id=123', ua: 'Mozilla/5.0 HeadlessChrome/147' });
    expect(seen[1]!.cookie).toBeUndefined();
    expect(seen[1]!.ua).toMatch(/Chrome\/125/);
    expect((await store.getAllCookies()).map((c) => `${c.key}=${c.value}`)).toEqual(['session-id=123', 'at-main=renewed']);
  });
});

describe('amazonAccount', () => {
  it('reads signed-out pages in any language', () => {
    expect(amazonAccount(amazonFixture('de-in-stock-delivery-fee'))).toEqual({ signedIn: false, accountName: null });
    expect(amazonAccount(amazonFixture('es-in-stock-free-delivery'))).toEqual({ signedIn: false, accountName: null });
    expect(amazonAccount('<html><body>no navigation</body></html>')).toEqual({ signedIn: null, accountName: null });
  });

  it('reads an Amazon Business navigation bar: its account link is marked "signin" even when signed in', () => {
    const nav = (href: string) =>
      `<header id="navbar-main"><a href="${href}" class="nav-a nav-a-2" data-nav-ref="nav_youraccount_btn" data-nav-role="signin">` +
      '<span class="nav-line-1">Hello, Gil</span><span class="nav-line-2">Account for Gil Lopes Teixeira</span></a></header>';
    expect(amazonAccount(nav('/-/en/gp/css/homepage.html?ref_=abn_bnav_youraccount_btn'))).toEqual({ signedIn: true, accountName: 'Gil' });
    expect(amazonAccount(nav('/-/en/ap/signin?openid.return_to=x'))).toEqual({ signedIn: false, accountName: null });
  });

  it('counts the page as signed in when any account link leads to the account, or there is a sign-out link', () => {
    const switchFirst =
      '<div id="nav-link-accountList"><a href="/ap/signin?switch_account=1">Switch accounts</a>' +
      '<a href="/gp/css/homepage.html"><span id="nav-link-accountList-nav-line-1">Olá, Gil</span></a></div>';
    expect(amazonAccount(switchFirst)).toEqual({ signedIn: true, accountName: 'Gil' });
    expect(amazonAccount('<a id="nav-item-signout" href="/gp/flex/sign-out.html">Sign out</a>').signedIn).toBe(true);
  });

  it('reads a signed-in page, with the account address as the delivery location', () => {
    const html = signedInAmazonPage(amazonFixture('es-in-stock-free-delivery'), 'Gil', 'Lisboa 1000-001');
    expect(amazonAccount(html)).toEqual({ signedIn: true, accountName: 'Gil' });
    const page = parseAmazonPage(html, marketplaceIn(BUILT_IN_CATALOG, 'amazon.es')!);
    expect(page).toMatchObject({ signedIn: true, accountName: 'Gil', deliverToText: 'Lisboa 1000-001', price: 964.69 });
  });
});

describe('VAT', () => {
  const de = marketplaceIn(BUILT_IN_CATALOG, 'amazon.de')!;
  const businessDe = marketplaceIn(BUILT_IN_CATALOG, 'business.amazon.de')!;

  it('reads consumer pages as priced with VAT, in English and Portuguese', () => {
    expect(parseAmazonPage(amazonFixture('de-in-stock-delivery-fee'), de).priceIncludesVat).toBe(true);
    expect(parseAmazonPage(amazonFixture('es-in-stock-free-delivery'), de).priceIncludesVat).toBe(true);
  });

  it('reads a business page priced without VAT', () => {
    const page = parseAmazonPage(businessAmazonPage(amazonFixture('de-in-stock-delivery-fee'), 'Gil', 'Lisboa 1000-001'), businessDe);
    expect(page).toMatchObject({ priceIncludesVat: false, price: 949, signedIn: true });
  });

  it('tracks the price without VAT when a business page labels both (Amazon Business Spain)', () => {
    // The buy box shows "€794.12 (945.00 incl. VAT)"; the add-to-cart form carries 945.0
    const page = parseAmazonPage(amazonFixture('business-es-vat-both'), marketplaceIn(BUILT_IN_CATALOG, 'business.amazon.es')!);
    expect(page).toMatchObject({
      kind: 'product',
      signedIn: true,
      accountName: 'Alex',
      price: 794.12,
      priceIncludesVat: false,
      priceInclVat: 945,
      currency: 'EUR',
      shipping: 0,
      // Not the VAT invoice note next to it
      seller: 'MICRO COMPUTER (HK) TECH LIMITED',
      shipsFrom: 'Amazon',
    });
  });
});
