// Reads a shop's product page from the schema.org data most shops publish for search engines:
// JSON-LD first, then microdata, then price meta tags. Pages also describe other products
// (recommendations, colour variants), so the product whose URL matches the page's canonical address wins.
// A page that sells several versions (a ProductGroup, as Shopify publishes) also lists them, each with its
// own price; which one a listing tracks is the adapter's choice.
import * as cheerio from 'cheerio';
import { parseAmount } from '../../pricing/money.ts';

export type DataSource = 'json-ld' | 'microdata' | 'meta';

export interface ShopOffer {
  price: number | null;
  currency: string | null;
  availability: string | null;
  condition: string | null;
  seller: string | null;
  shipping: number | null;
}

/** One version of a product sold on the same page, e.g. "32GB RAM + 1TB SSD". */
export interface ShopVariant {
  /** The version's name without the product's name in front of it. */
  label: string;
  /** The version's own address (Shopify: the page with ?variant=…). */
  url: string | null;
  sku: string | null;
  offer: ShopOffer;
}

export interface ShopPage {
  dataSource: DataSource | null;
  title: string | null;
  sku: string | null;
  gtin: string | null;
  /** The offer the page leads with: the first in-stock one with a price, else the first with a price. */
  offer: ShopOffer | null;
  offers: ShopOffer[];
  /** The versions the page sells, when it lists more than one; each has its own price. */
  variants: ShopVariant[];
  inStock: boolean | null;
  availabilityText: string | null;
  siteName: string | null;
  canonicalUrl: string | null;
}

type Json = Record<string, any>;
/** A DOM element as cheerio returns it (cheerio doesn't re-export the type). */
const selectElements = ($: cheerio.CheerioAPI) => $('*').toArray();
type El = ReturnType<typeof selectElements>[number];

const AVAILABILITY: Record<string, { inStock: boolean; text: string }> = {
  instock: { inStock: true, text: 'In stock' },
  limitedavailability: { inStock: true, text: 'Limited availability' },
  onlineonly: { inStock: true, text: 'Online only' },
  instoreonly: { inStock: true, text: 'In store only' },
  preorder: { inStock: true, text: 'Pre-order' },
  presale: { inStock: true, text: 'Pre-sale' },
  backorder: { inStock: true, text: 'Back order' },
  outofstock: { inStock: false, text: 'Out of stock' },
  soldout: { inStock: false, text: 'Sold out' },
  discontinued: { inStock: false, text: 'Discontinued' },
  oos: { inStock: false, text: 'Out of stock' },
};

/** "http://schema.org/InStock", "InStock", "in stock" -> { inStock, text } */
export function readAvailability(raw: string | null | undefined): { inStock: boolean | null; text: string | null } {
  if (!raw) return { inStock: null, text: null };
  const token = raw.split('/').pop()!.toLowerCase().replace(/[\s_-]/g, '');
  const known = AVAILABILITY[token];
  return known ?? { inStock: null, text: raw };
}

const lastSegment = (v: unknown): string | null => (typeof v === 'string' && v ? (v.split('/').pop() ?? v) : null);
const firstOf = <T>(v: T | T[] | undefined | null): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));
const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
  return s && s.trim() ? s.replace(/\s+/g, ' ').trim() : null;
};
const amount = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' ? parseAmount(v) : null);

/** Compares page addresses ignoring scheme, "www.", trailing slash, query and fragment. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined, base?: string): boolean {
  if (!a || !b) return false;
  const norm = (u: string) => {
    try {
      const url = new URL(u, base);
      return (url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '')).toLowerCase();
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
}

function pickOffer(offers: ShopOffer[]): ShopOffer | null {
  const priced = offers.filter((o) => o.price !== null);
  return priced.find((o) => readAvailability(o.availability).inStock !== false) ?? priced[0] ?? null;
}

// ---- JSON-LD ----

function jsonLdNodes($: cheerio.CheerioAPI): Json[] {
  const nodes: Json[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    const o = n as Json;
    if (o['@graph']) walk(o['@graph']);
    if (o['@type']) nodes.push(o);
    if (o.mainEntity) walk(o.mainEntity);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).text().trim().replace(/^<!--|-->$/g, '');
    try {
      walk(JSON.parse(text));
    } catch {
      try {
        walk(JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '))); // raw newlines inside strings
      } catch {
        // unreadable block; ignore
      }
    }
  });
  return nodes;
}

const isType = (n: Json, type: RegExp) => ([] as unknown[]).concat(n['@type']).some((t) => typeof t === 'string' && type.test(t));

function jsonLdOffer(o: Json): ShopOffer {
  const spec = firstOf(o.priceSpecification) as Json | undefined;
  const shippingRate = (firstOf(o.shippingDetails) as Json | undefined)?.shippingRate;
  return {
    price: amount(o.price) ?? amount(o.lowPrice) ?? amount(spec?.price),
    currency: str(o.priceCurrency) ?? str(spec?.priceCurrency),
    availability: lastSegment(o.availability),
    condition: lastSegment(o.itemCondition),
    seller: str(typeof o.seller === 'string' ? o.seller : (firstOf(o.seller) as Json | undefined)?.name),
    shipping: amount((firstOf(shippingRate) as Json | undefined)?.value),
  };
}

const absolute = (u: unknown, base: string): string | null => {
  if (typeof u !== 'string' || !u) return null;
  try {
    return new URL(u, base).toString();
  } catch {
    return null;
  }
};

/** "MINISFORUM M1 Pro - 32GB RAM + 1TB SSD" in group "MINISFORUM M1 Pro" -> "32GB RAM + 1TB SSD". */
function variantLabel(v: Json, groupName: string | null): string | null {
  const name = str(v.name);
  if (name && groupName && name.toLowerCase().startsWith(groupName.toLowerCase())) {
    const rest = name.slice(groupName.length).replace(/^[\s\-–—:|/,]+/, '').trim();
    if (rest) return rest;
  }
  if (name) return name;
  // No name: the properties the versions differ in
  const props = ['color', 'size', 'material', 'pattern'].map((k) => str(v[k])).filter((x): x is string => !!x);
  return props.length ? props.join(' / ') : null;
}

/** The versions of a ProductGroup (schema.org hasVariant), when there's more than one. */
function variantsOf(group: Json, pageUrl: string): ShopVariant[] {
  const groupName = str(group.name);
  const variants = ([] as unknown[])
    .concat(group.hasVariant ?? [])
    .filter((v): v is Json => !!v && typeof v === 'object')
    .flatMap((v): ShopVariant[] => {
      const offerJson = firstOf(v.offers) as Json | undefined;
      const label = variantLabel(v, groupName);
      if (!label || !offerJson) return [];
      const url = absolute(v.url, pageUrl) ?? absolute(offerJson.url, pageUrl) ?? absolute(typeof v['@id'] === 'string' ? v['@id'].replace(/#.*$/, '') : null, pageUrl);
      return [{ label, url, sku: str(v.sku), offer: jsonLdOffer(offerJson) }];
    });
  return variants.length > 1 ? variants : [];
}

function fromJsonLd($: cheerio.CheerioAPI, pageUrl: string, canonical: string | null): Partial<ShopPage> | null {
  const nodes = jsonLdNodes($);
  const products = nodes.filter((n) => isType(n, /^Product(Group|Model)?$/));
  if (!products.length) return null;
  const offersOf = (p: Json): Json[] => ([] as Json[]).concat(p.offers ?? []).flatMap((o) => (o?.offers ? [o, ...[].concat(o.offers)] : [o]));
  const matches = (p: Json) => [p.url, p['@id'], ...offersOf(p).map((o) => o?.url)].some((u) => sameAddress(u, canonical ?? pageUrl, pageUrl));
  const product = products.find(matches) ?? products.find((p) => offersOf(p).length) ?? products[0]!;
  const offers = offersOf(product).map(jsonLdOffer);
  // Pages can carry the same group twice (the theme's and an app's): the page's own, else the first
  const groups = products.filter((p) => isType(p, /^ProductGroup$/) && p.hasVariant);
  const group = groups.find((g) => [g.url, g['@id']].some((u) => sameAddress(typeof u === 'string' ? u.replace(/#.*$/, '') : u, canonical ?? pageUrl, pageUrl))) ?? groups[0];
  return {
    dataSource: 'json-ld',
    variants: group ? variantsOf(group, pageUrl) : [],
    title: str(product.name),
    sku: str(product.sku),
    gtin: str(product.gtin13) ?? str(product.gtin) ?? str(product.gtin14) ?? str(product.gtin12) ?? str(product.gtin8) ?? str(product.ean),
    offers,
    offer: pickOffer(offers),
  };
}

// ---- Microdata ----

function fromMicrodata($: cheerio.CheerioAPI, pageUrl: string, canonical: string | null): Partial<ShopPage> | null {
  // A property belongs to the nearest itemscope above it
  const props = (scope: El, name: string): El[] =>
    $(scope)
      .find(`[itemprop~="${name}"]`)
      .filter((_, d) => $(d).parent().closest('[itemscope]')[0] === scope)
      .toArray();
  const value = (el: El | undefined): string | null => {
    if (!el) return null;
    const $el = $(el);
    return str($el.attr('content') ?? $el.attr('href') ?? $el.attr('src') ?? $el.attr('value') ?? $el.text());
  };
  const prop = (scope: El, name: string) => value(props(scope, name)[0]);

  // Products in lists (recommendations, "related") aren't the page's product
  const scopes = $('[itemscope][itemtype*="schema.org/Product"]')
    .toArray()
    .filter((el) => !/itemListElement/.test($(el).attr('itemprop') ?? '') && $(el).parents('[itemtype*="schema.org/ItemList"]').length === 0);
  if (!scopes.length) return null;
  const scope = scopes.find((el) => sameAddress(prop(el, 'url'), canonical ?? pageUrl, pageUrl)) ?? scopes[0]!;

  const offers: ShopOffer[] = props(scope, 'offers').map((o) => {
    const seller = props(o, 'seller')[0];
    return {
      price: amount(prop(o, 'price')) ?? amount(prop(o, 'lowPrice')),
      currency: prop(o, 'priceCurrency'),
      availability: lastSegment(prop(o, 'availability')),
      condition: lastSegment(prop(o, 'itemCondition')),
      seller: seller ? (prop(seller, 'name') ?? value(seller)) : null,
      shipping: null,
    };
  });
  // Some pages put the price on the product itself
  if (!offers.length && prop(scope, 'price')) {
    offers.push({
      price: amount(prop(scope, 'price')),
      currency: prop(scope, 'priceCurrency'),
      availability: lastSegment(prop(scope, 'availability')),
      condition: null,
      seller: null,
      shipping: null,
    });
  }
  return {
    dataSource: 'microdata',
    title: prop(scope, 'name'),
    sku: prop(scope, 'sku'),
    gtin: prop(scope, 'gtin13') ?? prop(scope, 'gtin') ?? prop(scope, 'gtin14'),
    offers,
    offer: pickOffer(offers),
  };
}

// ---- Meta tags (Open Graph / Facebook product tags) ----

function fromMeta($: cheerio.CheerioAPI): Partial<ShopPage> | null {
  const meta = (...names: string[]) => {
    for (const n of names) {
      const v = str($(`meta[property="${n}"], meta[name="${n}"]`).first().attr('content'));
      if (v) return v;
    }
    return null;
  };
  const price = amount(meta('product:price:amount', 'og:price:amount', 'product:sale_price:amount'));
  if (price === null) return null;
  const offer: ShopOffer = {
    price,
    currency: meta('product:price:currency', 'og:price:currency', 'product:sale_price:currency'),
    availability: meta('product:availability', 'og:availability'),
    condition: meta('product:condition'),
    seller: null,
    shipping: null,
  };
  return { dataSource: 'meta', title: meta('og:title'), sku: meta('product:retailer_item_id'), gtin: null, offers: [offer], offer };
}

export function parseShopPage(html: string, pageUrl: string): ShopPage {
  const $ = cheerio.load(html);
  const canonicalHref = $('link[rel="canonical"]').attr('href') ?? $('meta[property="og:url"]').attr('content') ?? null;
  let canonicalUrl: string | null = null;
  try {
    canonicalUrl = canonicalHref ? new URL(canonicalHref, pageUrl).toString() : null;
  } catch {
    canonicalUrl = null;
  }

  // Use the first source that has a priced offer; otherwise the first that found a product at all
  const found = [fromJsonLd($, pageUrl, canonicalUrl), fromMicrodata($, pageUrl, canonicalUrl), fromMeta($)].filter((r): r is Partial<ShopPage> => !!r);
  const best = found.find((r) => r.offer?.price != null) ?? found[0] ?? null;
  const availability = readAvailability(best?.offer?.availability ?? best?.offers?.[0]?.availability);

  return {
    dataSource: best?.dataSource ?? null,
    title: best?.title ?? str($('meta[property="og:title"]').attr('content')) ?? str($('title').first().text()),
    sku: best?.sku ?? null,
    gtin: best?.gtin ?? null,
    offer: best?.offer ?? null,
    offers: best?.offers ?? [],
    variants: best?.variants ?? [],
    inStock: availability.inStock,
    availabilityText: availability.text,
    siteName: str($('meta[property="og:site_name"]').attr('content')),
    canonicalUrl,
  };
}

/** The price element a picked CSS selector points at, as served (the content attribute wins over text). */
export function readSelector(html: string, selector: string): { found: boolean; text: string | null; price: number | null } {
  const $ = cheerio.load(html);
  let el: ReturnType<typeof $>;
  try {
    el = $(selector).first();
  } catch {
    return { found: false, text: null, price: null }; // not a selector cheerio understands
  }
  if (!el.length) return { found: false, text: null, price: null };
  const text = str(el.attr('content') ?? el.text());
  return { found: true, text, price: amount(text) };
}
