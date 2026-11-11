import { describe, expect, it } from 'vitest';
import { BUILT_IN_CATALOG, marketplaceIn } from '@price-tracker/shared';
import { amazonAdapter } from '../src/stores/amazon/adapter.ts';
import { parseAmazonPage } from '../src/stores/amazon/parse.ts';
import { parseProductUrl } from '../src/stores/registry.ts';
import type { PageFetcher } from '../src/stores/types.ts';
import { amazonFixture } from './fixtures.ts';

const de = marketplaceIn(BUILT_IN_CATALOG, 'amazon.de')!;
const es = marketplaceIn(BUILT_IN_CATALOG, 'amazon.es')!;
const se = marketplaceIn(BUILT_IN_CATALOG, 'amazon.se')!;
const parse = (url: string) => parseProductUrl(url, BUILT_IN_CATALOG);

describe('parseAmazonPage', () => {
  it('reads price, delivery fee, location, seller and variation (amazon.de)', () => {
    const page = parseAmazonPage(amazonFixture('de-in-stock-delivery-fee'), de);
    expect(page.kind).toBe('product');
    expect(page.asin).toBe('B0FH6K3HVC');
    expect(page.title).toMatch(/^Mini PC MINISFORUM M1 Pro-125H/);
    expect(page.variantLabel).toBe('M1 Pro-125H 32/1TB');
    expect(page.price).toBe(949);
    expect(page.currency).toBe('EUR');
    expect(page.shipping).toBe(9.22);
    expect(page.deliveryCountry).toBe('PT');
    expect(page.deliverToText).toBe('Portugal');
    expect(page.deliveryLocationShown).toBe(true);
    expect(page.inStock).toBe(true);
    expect(page.seller).toBe('MICRO COMPUTER (HK) TECH LIMITED');
    expect(page.shipsFrom).toBe('Amazon');
  });

  it('treats a delivery price without digits as free (amazon.es, Portuguese page)', () => {
    const page = parseAmazonPage(amazonFixture('es-in-stock-free-delivery'), es);
    expect(page.price).toBe(964.69);
    expect(page.shipping).toBe(0);
    // Amazon's own label for the option, as the Portuguese page writes it
    expect(page.variantLabel).toBe('M1, Pro-125H, 32/1TB');
    expect(page.deliveryLocationShown).toBe(true);
  });

  it('recognises an unavailable product with no delivery location set (amazon.se)', () => {
    const page = parseAmazonPage(amazonFixture('se-unavailable'), se);
    expect(page.kind).toBe('product');
    expect(page.price).toBeNull();
    expect(page.inStock).toBe(false);
    expect(page.availabilityText).toMatch(/Currently unavailable/);
    expect(page.deliveryCountry).toBe('SE');
    expect(page.deliveryLocationShown).toBe(false);
  });

  it('recognises a captcha page', () => {
    const html = '<html><body><form method="get" action="/errors/validateCaptcha"><input name="amzn"></form></body></html>';
    expect(parseAmazonPage(html, de).kind).toBe('captcha');
  });
});

describe('amazonAdapter.check', () => {
  const serve =
    (body: string, status = 200): PageFetcher =>
    async (url) => ({ status, url, body, requestCount: 1, durationMs: 5 });
  const target = (marketplace = de) => ({ marketplace, externalId: 'B0FH6K3HVC', url: `https://${marketplace.host}/dp/B0FH6K3HVC` });

  it('returns ok with delivery to Portugal guessed from the IP', async () => {
    const out = await amazonAdapter.check(target(), serve(amazonFixture('de-in-stock-delivery-fee')));
    expect(out).toMatchObject({ status: 'ok', price: 949, shipping: 9.22, deliveryLocation: 'Portugal', deliveryLocationSource: 'ip', pageExternalId: 'B0FH6K3HVC' });
  });

  it('returns unavailable, with the default location marked as such', async () => {
    const out = await amazonAdapter.check(target(se), serve(amazonFixture('se-unavailable')));
    expect(out.status).toBe('unavailable');
    expect(out.deliveryLocation).toBe("Sweden (Amazon's default; no location set)");
    expect(out.deliveryLocationSource).toBeNull();
  });

  it('maps refusals and missing pages', async () => {
    expect((await amazonAdapter.check(target(), serve('<html></html>', 503))).status).toBe('blocked');
    expect((await amazonAdapter.check(target(), serve('<html></html>', 404))).status).toBe('not_found');
    expect((await amazonAdapter.check(target(), serve('<html><title>x</title></html>'))).status).toBe('error');
  });
});

describe('parseProductUrl', () => {
  it('reads marketplace and ASIN from the usual URL shapes', () => {
    expect(parse('https://www.amazon.de/Mini-PC-MINISFORUM-M1-Pro-125H-Threads/dp/B0FH6K3HVC?th=1')).toEqual({
      kind: 'known',
      store: 'amazon',
      marketplace: 'amazon.de',
      externalId: 'B0FH6K3HVC',
      canonicalUrl: 'https://www.amazon.de/dp/B0FH6K3HVC',
    });
    expect(parse('amazon.com.be/gp/product/b0fh6k3hvc/ref=x')).toMatchObject({ kind: 'known', marketplace: 'amazon.com.be' });
    expect(parse('https://www.amazon.es/dp/B0FH6K3HVC/')).toMatchObject({ kind: 'known', externalId: 'B0FH6K3HVC' });
  });

  it("refuses Amazon pages it can't track, rather than offering them as a custom store", () => {
    expect(parse('https://www.amazon.com/dp/B0FH6K3HVC')).toMatchObject({ kind: 'invalid' }); // not an EU store
    expect(parse('https://www.amazon.co.uk/dp/B0FH6K3HVC')).toMatchObject({ kind: 'invalid' });
    expect(parse('https://www.amazon.de/s?k=minisforum')).toMatchObject({ kind: 'invalid' });
    expect(parse('https://amzn.eu/d/abc123')).toMatchObject({ kind: 'invalid' });
    expect(parse('not a url at all')).toMatchObject({ kind: 'invalid' });
  });
});
