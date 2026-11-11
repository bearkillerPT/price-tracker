# Price Tracker: design

Status: not implemented yet, design agreed on 2026-11-11.

A personal, self-hosted tool. It tracks product prices on a few EU web shops and sends a notification when a price changes. It started as a replacement for `services/pccomponentes` in `raspberryConfs`, a Python script that checks one pccomponentes.pt search every hour and posts to Gotify. That script stays for now: PcComponentes is on hold (see below).

## Scope

**v1 does:**

- Track products on Amazon and Amazon Business, EU stores only, and on shops added from the UI (see [Custom stores](#custom-stores)). PcComponentes is on hold.
- Sign in to a store through a server-side browser streamed to the web UI.
- Keep a full price history.
- Send alerts through Gotify.
- Run on the Raspberry Pi (NixOS).

**v1 doesn't:**

- Use official APIs. PA-API is gone; the Creators API needs affiliate sales; the Amazon Business API needs an approval process. It's not worth it for a personal tool.
- Track searches (see [Later](#later)).
- Support more than one app account.
- Provide a Docker deployment.

## Stores

| Store | Marketplaces | Currency | Sign-in |
|---|---|---|---|
| PcComponentes (on hold) | pccomponentes.com (ES), .pt, .fr, .it | EUR | Not needed; not in the tool for now |
| Amazon | amazon.de, .fr, .it, .es, .nl, .com.be, .ie, .se, .pl | EUR, except SEK on .se and PLN on .pl | Optional. Without signing in, Amazon already shows prices and shipping for delivery to Portugal, based on the IP. Signing in adds Prime prices and your exact address |
| Amazon Business | amazon.de, .fr, .it, .es | EUR | Required. Business prices only show to a business account. They're often shown without VAT and can have quantity tiers |

On EU Amazon stores, an ASIN usually means the same product in every country. Adding a product once by ASIN can therefore offer to track it in all Amazon and Amazon Business marketplaces.

## Custom stores

Added 2026-11-11. Any shop whose product pages publish schema.org product data, the data shops publish for search engines, can be added without code.

**Adding a shop:**

1. Paste a product link from a shop the app doesn't know into Add listing.
2. The app loads that page once (the preview) and shows what it found: title, price, stock, EAN. Otherwise it says why the shop can't be tracked: a bot challenge, or no product data.
3. If you confirm, the shop becomes a store and the listing is added.
   - The domain without `www.` is the store's ID (`radiopopular.pt`), and the store gets its own marketplace and rate group.
   - Limits: warn above 10 requests/hour, warn strongly above 30; default interval 3 h.
   - The preview's result becomes the listing's first check, so adding costs one request in total.

Previews are limited to one per shop every 10 s.

**Reading a page** (`stores/generic`):

- **Source order:** JSON-LD first, then microdata, then price meta tags (`product:price:amount`).
- **Which product:** pages also describe other products (recommendations, colour variants). The product whose URL matches the page's canonical address wins, and products inside lists are skipped. Radio Popular's page carries the grey and blue A17 before the black one it's for.
- **Out of stock:** the listing is `unavailable`. The price is kept but doesn't count as the product's price.
- **Listing ID:** the page's path plus any query parameters that pick the page. Tracking parameters (`utm_*`, `gclid`…) are dropped.
- **Bot challenges** (Cloudflare, DataDome, PerimeterX, Imperva, Akamai) are recognised and reported as `blocked`, naming the service. They're never worked around. A bot-detection script on a normal page isn't a block (Fnac loads DataDome's).

Stores are managed on the Stores page: rename, change the default interval, or remove (only without listings).

**Shops checked 2026-11-11**, one product page each:

| Shop | Result |
|---|---|
| fnac.pt | Works. JSON-LD with price, stock, condition, seller and EAN. Loads DataDome and Akamai bot detection, so keep intervals long. |
| radiopopular.pt | Works. Microdata, no bot protection. |
| worten.pt | Cloudflare challenge: can't be tracked. |
| switchtechnology.pt | Cloudflare challenge: can't be tracked. |
| pcdiga.pt | Redirects to pcdiga.com, then a Cloudflare challenge: can't be tracked. |

**Shops without product data** (added 2026-11-12): the preview offers "Pick the price on the page".

1. That opens the live browser (see [Live browser](#live-browser)) on the page. You click the price, and the picker works out a CSS selector for it. Its preference order:
   1. stable IDs;
   2. `itemprop` and `data-test*` attributes;
   3. class names that don't look generated;
   4. positions, as a last resort.

   It takes the shortest chain of parent elements that's unique on the page, so the price of a "related" product isn't picked by mistake.
2. The selector is then tested in the page as loaded without a browser:
   - **The price is there:** checks are plain page loads (`fetch_method = http`).
   - **The page's scripts add it:** checks load the page in Chromium (`fetch_method = browser`, about 400 MB while a check runs).
3. The test reads the preview's copy of the page when there's a recent one, so picking costs no extra request.

A picked selector wins over the page's product data. Stock and title still come from that data when present.

When a check can't find the element any more, the listing shows an error. "Pick the price element…" in its menu picks it again, for the whole store. The store's edit dialog also shows the selector and the fetch method.

**Condition** isn't read from the page for checks: it's what you say the listing sells, for any store. The preview pre-fills it from the page's `itemCondition` when the page states one.

## Concepts

- **Product**: something you want to buy, e.g. "Minisforum M1 Pro-125H 32GB/1TB". It has a name and an optional EAN.
- **Listing**: one page in one marketplace that sells the product, identified by `(marketplace, externalId)`; on Amazon the external ID is the ASIN. A product can have several listings in the same marketplace, e.g. a store's separate new and as-new pages. On Amazon, a listing's menu has "Track in more stores…": it adds the same ASIN in other marketplaces with that listing's settings. Pasting a link whose ASIN the product already tracks copies its settings the same way. Each listing has:
  - a **condition**: new, as-new, refurbished or used;
  - a **check interval**;
  - a **variant guard**: words that must or must not appear in the page title and in the selected option's label (e.g. Amazon's `M1 Pro-125H 32/1TB`). For example: must contain `32GB` and `1TB`, must not contain `barebone` or `0/0`. A check that fails the guard is stored as `variant_mismatch`, not as a price. Amazon groups versions under one page, and a listing can change underneath its ASIN.
- **Observation**: the result of one check of one listing. It holds:
  - the **headline price**: the price the page shows by default (the buy box on Amazon);
  - the **delivered price**, when signed in;
  - **every other offer** shown on the product page: seller, condition, price, shipping. Amazon's full list of other sellers needs a separate request, which is left out for now;
  - stock, currency, the result, and the raw extracted data.
- **Product price**: the cheapest headline price among the product's listings whose condition you accept.
- **Alert rule**, per product: price at or below a target, a drop of at least X%, any drop, back in stock, a daily summary.
- **Session**: a saved browser sign-in for one marketplace on one account.
- **Notification channel**: Gotify first.

## Fetching

- Each marketplace has a fixed fetch method, `http` or `browser`, chosen from what's known about the site (see the spike results). We never try HTTP first on a site known to block it. Custom stores get theirs from the price-pick test (see [Custom stores](#custom-stores)). Defaults:
  - Amazon and Amazon Business: `http`, with the session's cookies when signed in;
  - PcComponentes (on hold): `browser`, if passing Cloudflare's check by hand turns out to last (see [PcComponentes: on hold](#pccomponentes-on-hold)). If an HTTP check gets a bot challenge, the marketplace switches to `browser` and stays there until changed by hand.
- Signed-in checks send the session's cookies over plain HTTP, with the same user agent and language as the browser that signed in.
- Amazon renews cookies in its responses. Those are saved back to the session so it doesn't expire early.
- Using the cookies from a different client than the one that signed in is a little riskier for the account. If Amazon starts signing the session out or showing captchas, the marketplace can be switched to check in the browser instead.
- Amazon and Amazon Business share domains, so each account gets its own browser profile.
- Chromium runs headless, starts only when a check needs it, and shuts down when idle. Images, media and fonts are not loaded.

### Request volume, the main risk

Stores can block the IP or ban the account for automated traffic, and the UI says so plainly wherever an interval is set.

- **Intervals:** set per listing. The default comes from the store: 3 h for Amazon. The hard minimum is 30 min.
- **Rate counting:** each store shows two rates:
  - planned requests/hour, summed from its listings' intervals;
  - actual requests/hour, split by result: `ok`, `captcha`, `blocked`, `signed_out`, `variant_mismatch`, `error`.
- **Warnings:** they get stronger as the planned rate rises.
- **Shared limit:** Amazon and Amazon Business count as one, since they share the IP.
- **Scheduling:** checks run one at a time per store, with random jitter, so checks don't run in bursts.
- **Pausing:** after a captcha or block, the store pauses for some hours (doubling after each new block) and a notification goes out.

## Live browser

Added 2026-11-12. Chromium runs on the server and is shown live in the web UI. It's used to pick price elements now, and for sign-in next.

**How it works:**

- **Streaming:** a CDP screencast sends JPEG frames over a WebSocket (`/api/browser/live?id=…`). The UI's mouse, wheel and keyboard input is replayed with Playwright, and the page's viewport follows the size of the view.
- **Pick mode:** a script injected into the page highlights the element under the pointer and swallows clicks, so buttons and links don't fire. It reports the clicked element through an exposed binding. "Pick the parent element" widens a pick, for when a click lands on part of the price.
- **Chromium itself:** started on first use and closed a minute after the last user. Checks block images, media and fonts; the live view doesn't.
- **Sessions:** one at a time. A session closes after 3 min without a viewer, after 15 min without input, or after 30 min in any case.
- **Pages that open a new tab** are followed in the same page.
- **Keyboard:**
  - Ctrl/Cmd+V types the viewer's clipboard into the focused field, so password managers work.
  - Keys and mouse buttons held when the view loses focus are released. Switching windows (Alt+Tab, Super) would otherwise leave a modifier held in the server's browser and turn typing into shortcuts.
  - The view takes focus back when the window does, and shows "Click the page to type" while it doesn't have it.

**Safety:**

- The WebSocket handshake must come from the same origin, since browsers send cookies on cross-site handshakes too, and must carry a valid login.
- Requests to local and private addresses are aborted in every Chromium context. That covers localhost, RFC 1918 and link-local addresses, `.local`/`.lan` names and single-label names. The same check refuses such shop links, so the server's browser and fetcher can't reach the router, Gotify or Nextcloud. `ALLOW_PRIVATE_HOSTS=true` lifts it, for tests and development only.

**Chromium on NixOS:** Chromium comes from nixpkgs' `playwright-driver.browsers-chromium`, set as `PLAYWRIGHT_BROWSERS_PATH` by the dev shell (and by the NixOS module later). `playwright-core` is pinned to that version, 1.59.1. The bundle copies it to `dist/node_modules`, because it reads its own files at run time and so can't be bundled.

## Sign-in

Added 2026-11-12, for Amazon. Amazon Business will reuse it.

**Signing in:**

- **Where:** the Stores page lists every Amazon marketplace with its sign-in status. "Sign in" opens the marketplace in the live browser:
  - it starts from the last saved sign-in, if any, so Amazon recognises the device;
  - it follows the account link straight to the sign-in form;
  - pages come in English, like checks.
- **What you do:** sign in yourself, including codes or puzzles. Nothing is typed for you and no password is stored.
- **Saving:** "I'm signed in" saves the session once the page shows it signed in. That's read from the link inside `div#nav-link-accountList`: it points to `/ap/signin` while signed out, in every language; signed in, it greets you by name.
- **What's kept:** the browser's cookies and local storage (Playwright `storageState`), encrypted with AES-256-GCM using `SESSION_KEY`, plus the browser's own user agent. One session per store and marketplace, since each Amazon domain has its own cookies.
- **Needed sign-ins:** the list shows each marketplace's listing count and marks Amazon Business ones with listings but no sign-in as "Needed". After a sign-in, the app asks "Sign in to more stores?":
  - it lists the stores not signed in, grouped by kind, with the "Needed" ones ticked;
  - the ones you pick open one after another ("1 of 3"…);
  - stores Amazon signed you in to along the way are skipped;
  - closing a sign-in stops the run.
- **Other stores:** after saving, the store's other marketplaces are checked in the same browser, in the background: one home page each, skipping ones already signed in. Amazon may sign you in there with the same account; each one that shows you signed in is saved too. The check stops at the first that doesn't, so if Amazon doesn't share sign-ins it costs one page.

**Signed-in checks:**

- They send the session's cookies over plain HTTP, with the user agent of the browser that signed in.
- Cookies Amazon renews are saved back after each check.
- A signed-in page gives the delivered price to the account's address (`deliveryLocationSource = account`).
- When a check comes back signed out:
  - the session is marked expired, once, with a notification;
  - checks carry on without it;
  - the Stores page offers "Sign in again".
- "Forget" deletes the saved session. You stay signed in at Amazon itself.
- Sign-in contexts are plain browser contexts: nothing alters the browser's identity.

## Amazon Business

Added 2026-11-12; not yet tried with a real business account.

- **Marketplaces:** Germany, France, Italy and Spain (Amazon Business's EU ones), with their own IDs (`business.amazon.de`…) on the same hosts as Amazon. Listings, sign-ins and labels stay apart from Amazon's, and the request budget is shared with Amazon.
- **Adding listings:** Amazon links parse as Amazon. Add listing and "Track in more stores…" offer both groups for the same ASIN, and one submit creates listings in both.
- **Checks:**
  - Only with an active business sign-in. Without one, a check records `signed_out` and makes no request.
  - A page that comes back signed out is recorded as `signed_out`, never as a business price, and the session expires with a notification.
- **VAT:**
  - The price area (`#corePriceDisplay…`, `#vatMessage_feature_div`, the `tax_message` JSON) is read for "without VAT" or "with VAT" wording in the marketplaces' languages. The result is `priceIncludesVat`.
  - A price shown without VAT is kept as shown. `headlineEur` adds the delivery country's standard VAT (`pricing/vat.ts`), so it compares with other listings. The UI shows "€X excl. VAT, ≈ €Y with VAT".
- **To verify on real pages:** the wording on actual business pages, whether the price fields are the same, and quantity discounts (not read yet).

## Prices shown

- The headline price is the main figure everywhere, with the other offers one click away.
- When the page shows a delivery location, the headline is the delivered price: the item plus the shipping shown. Otherwise it's the listed price.
- Without signing in, Amazon picks the delivery location from the server's public IP. Next to those prices, the UI shows the location the page used, e.g. "Delivery to Portugal, based on the server's IP".
- Prices stay in the store's currency. Comparing across stores uses an approximate EUR figure based on the European Central Bank's daily rates, marked as approximate.
- Warnings shown next to prices:
  - when not signed in, the price may exclude VAT for your country and shipping;
  - Amazon Business prices may exclude VAT.

## App account

- There is a single account. On first run, a setup screen sets its password.
- `price-tracker reset-password`, run on the server, resets it and ends all login sessions.
- No tracking data references the account, so a reset never touches products, listings or history.

## Architecture

```
apps/api        Express + TypeScript + Drizzle (Postgres), with its own scheduler
apps/web        React + Vite + Tailwind + shadcn/ui
packages/shared zod schemas and types used by both: the API contract (src/api.ts) and store data (src/stores.ts)
```

- **Scheduling:** each listing's `next_check_at` is its schedule. For each rate group, one loop:
  - picks the most overdue listing and checks it;
  - waits 20–45 s before the next check to that group;
  - is woken early when a listing is added or "check now" is pressed (but never during that wait).

  A single process owns the schedule, so no job queue library is needed. pg-boss was the original plan, but it would only add its own tables and API.
- **Housekeeping:** every 5 min it:
  - fetches the ECB exchange rates, at most daily and only when a listing isn't priced in EUR;
  - sends the daily summary;
  - removes expired login sessions.
- **Serving:** the API serves the built frontend. `pnpm build` bundles the API with its dependencies into `apps/api/dist` (`main.js`, `cli.js` and the migrations), so running it needs only Node.

```ts
interface StoreAdapter {
  store: StoreId;
  parseUrl(url: URL): { marketplace: MarketplaceInfo; externalId: string } | null; // no request made
  normalizeExternalId(raw: string): string | null;
  canonicalUrl(marketplace: MarketplaceInfo, externalId: string): string;
  check(target: ListingTarget, fetchPage: PageFetcher): Promise<CheckOutcome>;
}
```

`fetchPage` is injected: the plain HTTP fetcher, with an anonymous cookie jar per marketplace, in production, and saved pages in tests. Signed-in sessions (step 2) will provide their own fetcher.

**Tables:**

- `app_account`, `app_sessions`: the app's single account and its login sessions.
- `products`, `listings`.
- `observations`: one row per check. Product-page offers are kept in a jsonb column. `request_count` feeds the per-store request rates, so no separate request log is needed.
- `alert_rules`, `alert_events`.
- `store_state`: the pause and back-off per rate group.
- `notification_channels`, `settings` (single row), `fx_rates`.
- `custom_stores`: shops added from the UI (domain, label, currency, default interval).
- `store_sessions` arrives with step 2.

## Deployment

- **Packaging:** the repo provides a Nix flake with the package and a NixOS module. `raspberryConfs` imports it the same way it imports `repos-website`.
- **Pi specifics:**
  - Postgres 17 is already running (from `plughere.nix`). The module adds a database and a user that connect locally with no password.
  - Node 24 comes from nixpkgs.
  - Playwright's downloaded browsers don't run on NixOS. `playwright-core` is pinned to the nixpkgs `playwright-driver` version, 1.59.1 in nixpkgs 26.05, and uses `playwright-driver.browsers`.
  - The web UI is served through nginx with ACME, like the other sites. Notifications post to the local Gotify on port 8082.
- Docker Compose for other machines can come later.

## Later

- **Search as listing discovery:** a product can have saved searches that run about once a day. New matches go to a "suggested listings" inbox for you to approve. This covers what the current Pixel script does (cheapest of several listings), without silently tracking the wrong product.
- Amazon's full list of other sellers (one extra request per check).
- More notification channels.
- Docker Compose deployment.

## First products to track

1. **Google Pixel 10 Pro** on pccomponentes.pt: the new and as-new listings the current script picks up.
2. **Minisforum M1 Pro-125H, 32GB RAM / 1TB SSD, not the barebone**. Amazon has several ASINs for it, and some sit in a variation family next to the barebone:
   - `B0FH6K3HVC` on amazon.de, .nl, .com.be and .es;
   - `B0FH6H1KGT` on amazon.de;
   - the barebone is `B0FH69H4K7` (amazon.com).

   PcComponentes listing: to be found.

## Spike results

Run on the Pi on 2026-11-11. Same public IP as the laptop.

The probe made one request per page with each method, 5–10 s apart.

### PcComponentes (pccomponentes.pt)

- Every method in the new stack gets Cloudflare's challenge page:
  - Node `fetch`: 403.
  - `curl`: 403.
  - Headless Chromium: 403, a Cloudflare "managed challenge" with a Turnstile check, still not passed after about 6 s.
- The current Python script (`requests`) still gets through from the same IP, including on its run straight after the probe.

### Amazon (`B0FH6K3HVC` on .es, .de, .se)

- **Plain HTTP works:** the full product page, no captcha, about 1.8 s and 1–2 MB per page. Chromium returns the same data in about 12 s.
- **Delivery to Portugal without signing in:** on .es and .de, Amazon set the delivery location to Portugal from the IP and showed shipping. Prices on 2026-11-11:
  - .es: €964.69, free delivery.
  - .de: €949.00 + €9.22 delivery.
  - .se: currently unavailable, no delivery location set.
- **What the page shows:**
  - the title;
  - the price, also in a hidden form field with amount and currency code;
  - a delivery message with cost and dates;
  - ships-from and sold-by (here: ships from Amazon, sold by MICRO COMPUTER (HK) TECH LIMITED);
  - a VAT note ("VAT may vary at checkout depending on your address");
  - availability;
  - the variation selector, with the ASIN of each option.
- **Variation family:** `B0FH6K3HVC` shares its page with the barebone (`B0HDYZBVQW`, "M1 Pro-125H 0/0 GB") and with other models (285H, G1, M2).
- **Other sellers:** the list isn't in the page; it loads in a separate request.

### Chromium on the Pi

- nixpkgs 26.05 has `playwright-driver.browsers-chromium` (Chromium build `chromium-1217`) prebuilt for aarch64: 183 MB download, nothing compiled. `playwright-core@1.59.1` from npm works with it.
- Only the full Chromium build is included, not `chromium-headless-shell`. Launch it with `chromium.launch({ channel: 'chromium', headless: true })`, with `PLAYWRIGHT_BROWSERS_PATH` pointing at the nix store path.
- Memory (PSS), measured offline with a saved Amazon page:

  | State | Memory |
  |---|---|
  | Idle | ~245 MB |
  | One page | ~415 MB |
  | Each extra page | ~85 MB more |

- Launching takes 2.3 s and rendering the page about 6 s. Fine to start on demand; not worth keeping running.

### Amazon sign-in

Confirmed by Gil: one account works across the EU stores, but each domain needs its own session cookie.

## PcComponentes: on hold

Decided 2026-11-11: PcComponentes is out of the tool for now, and the old `services/pccomponentes` script keeps running on the Pi. The notes below are for when it comes back.

**Tried 2026-11-12: passing the check by hand doesn't work.** In the live browser, Cloudflare's Turnstile check on pccomponentes.pt reloads and asks again after every click: it doesn't accept the server's automated Chromium even with a person clicking. Making it pass would mean disguising the browser as a person (headers, user agent, automation flags, a virtual display), which the tool won't do. Option 1 below is therefore closed. What's left is the Awin feed (option 2), or the old script.


PcComponentes needs no sign-in to show prices, but none of the new stack's clients gets past its Cloudflare check unattended.

The current Python script gets through because Cloudflare lets Python's HTTP client through, not because of a browser or a session. The new tool won't imitate another client to get past the check, and won't use stealth plugins or captcha-solving services.

The plan:

1. **You pass the check by hand in the streamed browser,** the same one built for sign-in. PcComponentes checks then run in that browser until the pass expires, and the app asks you to pass it again. Once the streamed browser exists, find out:
   - whether Cloudflare accepts the streamed browser at all;
   - how long a pass lasts.
2. **If that doesn't hold up:** PcComponentes' product feed through the Awin affiliate programme. It needs a publisher account and approval for the programme, and the feed probably updates about once a day.

The old script would be retired once the tool covers PcComponentes.

## Build order

1. ~~Database schema, app login, Amazon without sign-in (HTTP), Gotify, and the web UI to manage products and listings.~~ Done 2026-11-11.
2. Streamed browser sign-in.
   - ~~Live browser (Chromium streamed to the UI) and picking a shop's price element~~ Done 2026-11-12.
   - ~~Sign-in on top of it (Amazon)~~ Done 2026-11-12.
3. Amazon signed in, then Amazon Business.
4. ~~PcComponentes~~ On hold; the old script keeps tracking the Pixel.
   - ~~Custom stores (shops with schema.org product data)~~ Done 2026-11-11.
5. NixOS module and switching the Pi over. The old `services/pccomponentes` script keeps running alongside.
