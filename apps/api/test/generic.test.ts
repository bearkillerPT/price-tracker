import { describe, expect, it } from 'vitest';
import { BUILT_IN_CATALOG } from '@price-tracker/shared';
import type { Catalog, MarketplaceInfo } from '@price-tracker/shared';
import { customStoreEntries } from '../src/catalog.ts';
import { genericAdapter, pageRef } from '../src/stores/generic/adapter.ts';
import { parseShopPage, readAvailability } from '../src/stores/generic/parse.ts';
import { detectProtection } from '../src/stores/protection.ts';
import { parseProductUrl } from '../src/stores/registry.ts';
import type { PageFetcher } from '../src/stores/types.ts';
import { shopFixture } from './fixtures.ts';

const FNAC_URL = 'https://www.fnac.pt/Google-Pixel-10-Pro-256GB-Obsidiana-Telemovel-SmartPhone-Android/a13213894';
const RP_URL = 'https://www.radiopopular.pt/produto/smartphone-samsung-galaxy-a17-256gb-preto';
const MF_URL = 'https://minisforumpc.eu/products/minisforum-m1-pro-125h-mini-pc';

describe('parseShopPage', () => {
  it('reads JSON-LD product data (Fnac)', () => {
    const page = parseShopPage(shopFixture('fnac-out-of-stock'), FNAC_URL);
    expect(page).toMatchObject({
      dataSource: 'json-ld',
      title: 'Google Pixel 10 Pro - 256GB - Obsidiana',
      gtin: '0840353925380',
      inStock: false,
      availabilityText: 'Out of stock',
    });
    expect(page.offer).toMatchObject({ price: 829, currency: 'EUR', condition: 'NewCondition', seller: 'Fnac.pt' });
  });

  it("reads microdata and picks the page's own product, not a colour variant or a recommendation (Radio Popular)", () => {
    const page = parseShopPage(shopFixture('radiopopular-in-stock'), RP_URL);
    expect(page).toMatchObject({
      dataSource: 'microdata',
      title: 'SMARTPHONE SAMSUNG GALAXY A17 256GB PRETO',
      gtin: expect.any(String),
      inStock: true,
      availabilityText: 'In stock',
      siteName: 'Radio Popular',
      canonicalUrl: RP_URL,
    });
    expect(page.offer).toMatchObject({ price: 259.99, currency: 'EUR' });
  });

  it("lists the versions a page sells, each with its own price (Minisforum's Shopify ProductGroup)", () => {
    const page = parseShopPage(shopFixture('minisforum-versions'), MF_URL);
    expect(page.title).toBe('MINISFORUM M1 Pro-125H');
    expect(page.variants.map((v) => [v.label, v.offer.price, readAvailability(v.offer.availability).inStock])).toEqual([
      ['Intel Core™ Ultra 5 Processor 125H / Barebone(Not include os license)', 379, true],
      ['Intel Core™ Ultra 5 Processor 125H / 32GB RAM + 512GB SSD', 869, false],
      ['Intel Core™ Ultra 5 Processor 125H / 32GB RAM + 1TB SSD', 949, true],
    ]);
    expect(page.variants[2]!.url).toBe(`${MF_URL}?variant=52215880319342`);
  });

  it('falls back to price meta tags', () => {
    const html = `<html><head><meta property="og:title" content="Mouse X"><meta property="product:price:amount" content="19.90">
      <meta property="product:price:currency" content="EUR"><meta property="product:availability" content="in stock"></head></html>`;
    expect(parseShopPage(html, 'https://shop.example/p/1')).toMatchObject({ dataSource: 'meta', title: 'Mouse X', inStock: true, offer: { price: 19.9 } });
  });

  it('finds nothing on a page without product data', () => {
    expect(parseShopPage('<html><title>Hello</title></html>', 'https://shop.example/').dataSource).toBeNull();
  });

  it('reads availability in its usual spellings', () => {
    expect(readAvailability('http://schema.org/InStock')).toEqual({ inStock: true, text: 'In stock' });
    expect(readAvailability('https://schema.org/SoldOut')).toEqual({ inStock: false, text: 'Sold out' });
    expect(readAvailability('out of stock')).toEqual({ inStock: false, text: 'Out of stock' });
    expect(readAvailability(null)).toEqual({ inStock: null, text: null });
  });
});

describe('detectProtection', () => {
  it('recognises a Cloudflare challenge (Worten, PCDiga, Switch Technology)', () => {
    expect(detectProtection(403, { 'cf-mitigated': 'challenge' }, shopFixture('cloudflare-challenge'))).toBe('Cloudflare challenge');
    expect(detectProtection(403, {}, shopFixture('cloudflare-challenge'))).toBe('Cloudflare challenge');
  });

  it("doesn't flag a normal page that loads a bot-detection script (Fnac loads DataDome's)", () => {
    expect(detectProtection(200, {}, shopFixture('fnac-out-of-stock'))).toBeNull();
    expect(detectProtection(200, {}, shopFixture('radiopopular-in-stock'))).toBeNull();
  });
});

describe('genericAdapter.check', () => {
  const marketplace = (id: string): MarketplaceInfo => ({ id, store: id, host: `www.${id}`, country: 'PT', label: id, currency: 'EUR' });
  const serve =
    (body: string, status = 200, headers: Record<string, string> = {}): PageFetcher =>
    async (url, options) => {
      expect(options.acceptLanguage).toMatch(/^pt-PT/);
      return { status, url, body, headers, requestCount: 1, durationMs: 5 };
    };

  it('returns ok with the price for an in-stock page', async () => {
    const out = await genericAdapter.check({ marketplace: marketplace('radiopopular.pt'), externalId: '/produto/x', url: RP_URL }, serve(shopFixture('radiopopular-in-stock')));
    expect(out).toMatchObject({ status: 'ok', price: 259.99, currency: 'EUR', inStock: true, raw: { dataSource: 'microdata' } });
  });

  it('returns unavailable (keeping the price) when out of stock', async () => {
    const out = await genericAdapter.check({ marketplace: marketplace('fnac.pt'), externalId: '/a13213894', url: FNAC_URL }, serve(shopFixture('fnac-out-of-stock')));
    expect(out).toMatchObject({ status: 'unavailable', price: 829, inStock: false, seller: 'Fnac.pt' });
  });

  it('returns blocked, naming the protection, for a bot challenge', async () => {
    const out = await genericAdapter.check(
      { marketplace: marketplace('worten.pt'), externalId: '/produtos/x', url: 'https://www.worten.pt/produtos/x' },
      serve(shopFixture('cloudflare-challenge'), 403, { 'cf-mitigated': 'challenge' }),
    );
    expect(out).toMatchObject({ status: 'blocked', error: 'The shop answered with a Cloudflare challenge instead of the page' });
  });

  describe('on a page that sells several versions', () => {
    const minisforum = marketplace('minisforumpc.eu');
    const run = (url: string, guardInclude: string[] = [], guardExclude: string[] = []) =>
      genericAdapter.check({ marketplace: minisforum, externalId: pageRef(new URL(url)), url, guardInclude, guardExclude }, serve(shopFixture('minisforum-versions')));

    it('tracks the version its terms pick out', async () => {
      const out = await run(MF_URL, ['1TB']);
      expect(out).toMatchObject({ status: 'ok', price: 949, inStock: true, variantLabel: 'Intel Core™ Ultra 5 Processor 125H / 32GB RAM + 1TB SSD', offers: [] });
      expect(out.raw.variant).toBe(`${MF_URL}?variant=52215880319342`);
      expect(out.raw.variants).toHaveLength(3);
    });

    it('tracks the version the link points at', async () => {
      const out = await run(`${MF_URL}?variant=53465203507566&utm_source=x`);
      expect(out).toMatchObject({ status: 'unavailable', price: 869, inStock: false, variantLabel: expect.stringContaining('512GB') });
    });

    it("tracks the page's default, the first in stock, without terms or a version in the link", async () => {
      const out = await run(MF_URL);
      expect(out).toMatchObject({ status: 'ok', price: 379, variantLabel: expect.stringContaining('Barebone') });
    });

    it('says which versions there are when the terms fit none or several', async () => {
      const none = await run(MF_URL, ['2TB']);
      expect(none.status).toBe('variant_mismatch');
      expect(none.price).toBeNull();
      expect(none.error).toBe(
        "None of the page's 3 versions fits the version check terms. The page sells: Barebone(Not include os license) €379.00; 32GB RAM + 512GB SSD €869.00 (out of stock); 32GB RAM + 1TB SSD €949.00",
      );
      const several = await run(MF_URL, ['32GB'], ['barebone']);
      expect(several.status).toBe('variant_mismatch');
      expect(several.error).toMatch(/^2 of the page's versions fit the version check terms: 32GB RAM \+ 512GB SSD .*; 32GB RAM \+ 1TB SSD .*\. Add a term only one of them has\.$/);
    });
  });

  it('returns an error when the page has no product data', async () => {
    const out = await genericAdapter.check({ marketplace: marketplace('shop.pt'), externalId: '/', url: 'https://www.shop.pt/' }, serve('<html><title>x</title></html>'));
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/No product data/);
  });
});

describe('custom store URLs', () => {
  const withRadioPopular: Catalog = (() => {
    const e = customStoreEntries({ id: 'radiopopular.pt', host: 'www.radiopopular.pt', label: 'Radio Popular', currency: 'EUR', defaultIntervalMinutes: 180 });
    return {
      stores: [...BUILT_IN_CATALOG.stores, e.store],
      marketplaces: [...BUILT_IN_CATALOG.marketplaces, e.marketplace],
      rateGroups: [...BUILT_IN_CATALOG.rateGroups, e.rateGroup],
    };
  })();

  it('drops tracking parameters but keeps the ones that pick the page', () => {
    expect(pageRef(new URL('https://shop.pt/p/123?utm_source=x&gclid=y&color=black#reviews'))).toBe('/p/123?color=black');
    expect(pageRef(new URL('https://shop.pt/produto/abc/'))).toBe('/produto/abc/');
  });

  it("offers an unknown shop for a preview, and recognises it once it's a custom store", () => {
    expect(parseProductUrl(`${RP_URL}?utm_source=newsletter`, BUILT_IN_CATALOG)).toEqual({ kind: 'unknown', host: 'www.radiopopular.pt', url: RP_URL });
    expect(parseProductUrl('radiopopular.pt/produto/smartphone-samsung-galaxy-a17-256gb-preto', withRadioPopular)).toEqual({
      kind: 'known',
      store: 'radiopopular.pt',
      marketplace: 'radiopopular.pt',
      externalId: '/produto/smartphone-samsung-galaxy-a17-256gb-preto',
      canonicalUrl: RP_URL,
    });
  });
});
