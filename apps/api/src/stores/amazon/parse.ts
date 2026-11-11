// Reads an Amazon product page. Prefers language-independent markup (hidden form fields, data-*
// attributes, the page's JSON state) over visible text, since each marketplace has its own language.
import * as cheerio from 'cheerio';
import type { Currency, MarketplaceInfo } from '@price-tracker/shared';
import { CURRENCIES } from '@price-tracker/shared';
import { parseAmount } from '../../pricing/money.ts';

export interface AmazonPage {
  kind: 'product' | 'captcha' | 'unknown';
  asin: string | null;
  title: string | null;
  /** Selected option of each variation dimension, joined with " / ", e.g. "M1 Pro-125H 32/1TB". */
  variantLabel: string | null;
  price: number | null;
  currency: Currency | null;
  /** false: the price area says the price is without VAT (Amazon Business); true: with VAT; null: doesn't say. */
  priceIncludesVat: boolean | null;
  /** 0 when delivery is free, null when the page shows no delivery price. */
  shipping: number | null;
  deliveryText: string | null;
  /** ISO country Amazon priced delivery to, from the page state. */
  deliveryCountry: string | null;
  deliveryZip: string | null;
  /** The visible "Deliver to" text, e.g. "Portugal", or "Update location" when none is set. */
  deliverToText: string | null;
  /** Whether the visible "Deliver to" text names that country (or postcode); false means Amazon's default. */
  deliveryLocationShown: boolean;
  inStock: boolean | null;
  availabilityText: string | null;
  seller: string | null;
  shipsFrom: string | null;
  /** From the account link: null when the page has no navigation bar. */
  signedIn: boolean | null;
  /** The name the page greets a signed-in account with ("Hello, Gil" -> "Gil"). */
  accountName: string | null;
}

// The account link(s) in the navigation bar: Amazon's sits in div#nav-link-accountList (and carries
// data-csa-c-slot-id="nav-link-accountList"); Amazon Business's carries data-nav-role="signin" whether or not
// you're signed in, so its target is what tells.
const ACCOUNT_LINKS = '#nav-link-accountList a[href], a[data-csa-c-slot-id="nav-link-accountList"], a[data-nav-role="signin"][href]';
const SIGN_OUT_LINKS = '#nav-item-signout, a[href*="/gp/flex/sign-out"], a[href*="/ap/signout"]';

/**
 * Whether the page is signed in, in any language. Signed out, every account link goes to the sign-in form
 * (/ap/signin). Signed in, the account link goes to the account (and the page greets you by name), or the
 * page has a sign-out link. null when the page has no navigation bar.
 */
export function amazonAccount(html: string): { signedIn: boolean | null; accountName: string | null } {
  const $ = cheerio.load(html);
  const links = $(ACCOUNT_LINKS).toArray();
  const toSignIn = (el: (typeof links)[number]) => /\/ap\/signin/.test($(el).attr('href') ?? '');
  const accountLink = links.find((el) => !toSignIn(el));
  const signedIn = accountLink !== undefined || $(SIGN_OUT_LINKS).length > 0;
  if (!signedIn) return { signedIn: links.length ? false : null, accountName: null };
  // "Hello, Gil": Amazon's greeting line, or the first line of the account link
  const greeting = clean($('#nav-link-accountList-nav-line-1').first().text()) ?? (accountLink ? clean($(accountLink).find('.nav-line-1').first().text()) : null);
  return { signedIn: true, accountName: greeting?.split(',').slice(1).join(',').trim() || null };
}

const LANGUAGES = ['en', 'pt', 'es', 'de', 'fr', 'it', 'nl', 'sv', 'pl'];

// "Without VAT" and "with VAT" in the marketplaces' languages. Checked in the price area only: business
// pages can mention VAT elsewhere (banners, account switches).
const EXCLUDES_VAT = /\bexcl(?:\.|uding)?\s*VAT\b|\bex\.?\s*VAT\b|without VAT|exkl\.?\s*MwSt|ohne MwSt|zzgl\.?\s*MwSt|\bHT\b|hors tax|IVA esclusa|IVA escl\.|esclusa IVA|sin IVA|IVA no incluido|IVA excluído|sem IVA|excl\.?\s*btw|exkl\.?\s*moms|bez VAT|\bnetto\b/i;
const INCLUDES_VAT = /\bincl(?:\.|uding)?\s*VAT\b|include[sd]? VAT|inkl\.?\s*MwSt|\bTTC\b|IVA inclusa|IVA incluido|IVA incluído|incluem IVA|incl\.?\s*btw|inkl\.?\s*moms|z VAT|\bbrutto\b/i;

/** Whether the price area states the price with or without VAT. */
export function priceVat($: cheerio.CheerioAPI, html: string): boolean | null {
  const area = ['#corePriceDisplay_desktop_feature_div', '#corePrice_feature_div', '#apex_desktop', '#vatMessage_feature_div', '#taxInclusiveMessage']
    .map((sel) => $(sel).first().text())
    .join(' ')
    .replace(/\s+/g, ' ');
  // Some pages also carry it as JSON: "tax_message":{"value":"IVA incluído", ...} (escaped in an attribute)
  const taxMessage = html.match(/tax_message(?:\\?&quot;|\\"|")\s*:\s*\{(?:\\?&quot;|\\"|")value(?:\\?&quot;|\\"|")\s*:\s*(?:\\?&quot;|\\"|")([^"&\\]{1,60})/)?.[1] ?? '';
  const text = `${area} ${taxMessage}`;
  if (EXCLUDES_VAT.test(text)) return false;
  if (INCLUDES_VAT.test(text)) return true;
  return null;
}

const clean = (s: string | undefined | null): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length ? t : null;
};

export function countryName(code: string, language = 'en'): string | null {
  try {
    return new Intl.DisplayNames([language], { type: 'region' }).of(code) ?? null;
  } catch {
    return null;
  }
}

export function parseAmazonPage(html: string, marketplace: MarketplaceInfo): AmazonPage {
  const $ = cheerio.load(html);
  const text = (selector: string) => clean($(selector).first().text());

  const isCaptcha =
    $('form[action*="validateCaptcha"]').length > 0 ||
    /opfcaptcha|Type the characters you see in this image|api-services-support@amazon\.com/i.test(html);
  const title = text('#productTitle');

  const page: AmazonPage = {
    kind: isCaptcha ? 'captcha' : title ? 'product' : 'unknown',
    asin: clean($('input#ASIN').first().attr('value')),
    title,
    variantLabel: null,
    price: null,
    currency: null,
    priceIncludesVat: null,
    shipping: null,
    deliveryText: null,
    deliveryCountry: null,
    deliveryZip: null,
    deliverToText: text('#glow-ingress-line2'),
    deliveryLocationShown: false,
    inStock: null,
    availabilityText: null,
    seller: null,
    shipsFrom: null,
    ...amazonAccount(html),
  };
  if (page.kind !== 'product') return page;

  // Variation: one "selected value" element per dimension (size, configuration, colour...)
  const dimensions = $('[id^="inline-twister-expanded-dimension-text-"]')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter((v): v is string => !!v);
  if (!dimensions.length) {
    $('[id^="variation_"] .selection').each((_, el) => {
      const v = clean($(el).text());
      if (v) dimensions.push(v);
    });
  }
  page.variantLabel = dimensions.length ? dimensions.join(' / ') : null;

  // Price: the add-to-cart form's hidden fields first, then the displayed price
  const amountField = $('input[name="items[0.base][customerVisiblePrice][amount]"]').first().attr('value');
  const currencyField = $('input[name="items[0.base][customerVisiblePrice][currencyCode]"]').first().attr('value');
  page.price = parseAmount(amountField);
  if (page.price === null) {
    for (const sel of [
      '#corePrice_feature_div .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
      '#apex_desktop .priceToPay .a-offscreen',
      '#price_inside_buybox',
      '#priceblock_ourprice',
    ]) {
      page.price = parseAmount(text(sel));
      if (page.price !== null) break;
    }
  }
  page.priceIncludesVat = page.price !== null ? priceVat($, html) : null;
  page.currency =
    currencyField && (CURRENCIES as readonly string[]).includes(currencyField) ? (currencyField as Currency) : page.price !== null ? marketplace.currency : null;

  // Delivery: the primary delivery message carries its price as a data attribute ("€9.22", or a word for free)
  const delivery = $('#mir-layout-DELIVERY_BLOCK [data-csa-c-delivery-price]').first().length
    ? $('#mir-layout-DELIVERY_BLOCK [data-csa-c-delivery-price]').first()
    : $('[data-csa-c-delivery-price]').first();
  if (delivery.length) {
    const deliveryPrice = clean(delivery.attr('data-csa-c-delivery-price'));
    page.shipping = deliveryPrice === null ? null : /\d/.test(deliveryPrice) ? parseAmount(deliveryPrice) : 0;
    page.deliveryText = clean(delivery.text());
  }

  // Where the price is for: the page state Amazon renders for value-added services
  $('script[type="a-state"]').each((_, el) => {
    if (page.deliveryCountry) return;
    try {
      const key = JSON.parse($(el).attr('data-a-state') ?? '{}').key;
      if (key !== 'vas-base-vm') return;
      const state = JSON.parse($(el).text());
      page.deliveryCountry = typeof state.countryCode === 'string' ? state.countryCode : null;
      page.deliveryZip = typeof state.zipCode === 'string' ? state.zipCode : null;
    } catch {
      // not JSON; ignore
    }
  });
  if (page.deliveryCountry && page.deliverToText) {
    const shown = page.deliverToText.toLowerCase();
    const names = LANGUAGES.map((l) => countryName(page.deliveryCountry!, l)?.toLowerCase()).filter((n): n is string => !!n);
    page.deliveryLocationShown = names.some((n) => shown.includes(n)) || (!!page.deliveryZip && shown.includes(page.deliveryZip.toLowerCase()));
  }

  // Stock: a buy button and no out-of-stock block
  const canBuy = $('#add-to-cart-button, #buy-now-button').length > 0;
  const outOfStock = $('#outOfStock').length > 0;
  page.inStock = canBuy && !outOfStock;
  page.availabilityText = text('#availability') ?? text('#outOfStock .a-color-price') ?? text('#outOfStock');

  page.seller =
    text('#merchantInfoFeature_feature_div .offer-display-feature-text-message') ?? text('#sellerProfileTriggerId') ?? text('#merchant-info');
  page.shipsFrom = text('#fulfillerInfoFeature_feature_div .offer-display-feature-text-message');

  return page;
}
