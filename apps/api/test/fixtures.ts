import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';

/** Saved Amazon pages (scripts and styles stripped, postcode replaced), gzipped. */
export const amazonFixture = (name: string): string =>
  gunzipSync(readFileSync(path.join(import.meta.dirname, 'fixtures/amazon', `${name}.html.gz`))).toString('utf8');

/** Saved shop pages (scripts other than JSON-LD and styles stripped), gzipped. */
export const shopFixture = (name: string): string =>
  gunzipSync(readFileSync(path.join(import.meta.dirname, 'fixtures/shops', `${name}.html.gz`))).toString('utf8');

/** A saved (signed-out) Amazon page turned into the same page signed in as `name`, delivering to `address`. */
export function signedInAmazonPage(html: string, name: string, address: string): string {
  const $ = cheerio.load(html);
  $('#nav-link-accountList a[href]').first().attr('href', '/gp/css/homepage.html');
  $('#nav-link-accountList-nav-line-1').text(`Olá, ${name}`);
  $('#glow-ingress-line2').text(address);
  return $.html();
}

/** A signed-in page priced the Amazon Business way: without VAT. */
export function businessAmazonPage(html: string, name: string, address: string): string {
  const $ = cheerio.load(signedInAmazonPage(html, name, address));
  $('#vatMessage_feature_div').text('All prices excl. VAT.');
  return $.html();
}
