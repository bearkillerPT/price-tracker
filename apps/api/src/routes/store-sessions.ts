import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { Router } from 'express';
import { SignInSave, SignInStart } from '@price-tracker/shared';
import type { LiveSession as LiveSessionDto, MarketplaceInfo, SignInResult } from '@price-tracker/shared';
import type { LiveSessions } from '../browser/live.ts';
import type { CatalogService } from '../catalog.ts';
import { HttpError, validate } from '../http/errors.ts';
import { amazonAccount } from '../stores/amazon/parse.ts';
import { log } from '../log.ts';
import type { StoreSessions } from '../stores/sessions.ts';

// Amazon's sign-in link in the navigation bar, while signed out
const SIGN_IN_LINK = '#nav-link-accountList a[href*="/ap/signin"]';
// The language checks ask Amazon for (stores/amazon/adapter.ts), so the saved session matches them
const AMAZON_LOCALE = 'en-GB';

/** A marketplace's home page, where the navigation bar shows whether you're signed in. Tests point it elsewhere. */
export type HomeUrl = (marketplace: MarketplaceInfo) => string;
const defaultHomeUrl: HomeUrl = (m) => `https://${m.host}/`;

export function storeSessionRoutes(catalog: CatalogService, sessions: StoreSessions, live: LiveSessions, homeUrl: HomeUrl = defaultHomeUrl): Router {
  const r = Router();

  const signInTarget = (store: string, marketplaceId: string) => {
    const info = catalog.store(store);
    const marketplace = catalog.marketplace(marketplaceId);
    if (!info?.canSignIn || !info.implemented || marketplace?.store !== store) throw new HttpError(422, "You can't sign in to that store");
    if (!sessions.enabled) throw new HttpError(503, 'Set SESSION_KEY on the server to keep store sign-ins (openssl rand -base64 32)');
    return marketplace;
  };

  r.get('/store-sessions', async (_req, res) => {
    res.json(await sessions.list(catalog.get()));
  });

  // Opens the marketplace in the live browser (from the last sign-in, if any) and goes to its sign-in form
  r.post('/store-sessions/sign-in', async (req, res) => {
    const { store, marketplace: marketplaceId } = validate(SignInStart, req.body);
    const marketplace = signInTarget(store, marketplaceId);
    const storageState = (await sessions.state(store, marketplaceId)) ?? undefined;
    try {
      const session = await live.open(homeUrl(marketplace), AMAZON_LOCALE, {
        storageState,
        purpose: { kind: 'sign-in', store, marketplace: marketplaceId },
      });
      session.followLink(SIGN_IN_LINK);
      res.status(201).json({ id: session.id } satisfies LiveSessionDto);
    } catch (err) {
      throw new HttpError(503, err instanceof Error ? err.message : String(err));
    }
  });

  // Keeps the live browser's sign-in, once the store shows it signed in
  r.post('/store-sessions/save', async (req, res) => {
    const { store, marketplace, liveSessionId } = validate(SignInSave, req.body);
    signInTarget(store, marketplace);
    const session = live.get(liveSessionId);
    const purpose = session?.purpose;
    if (!session || purpose?.kind !== 'sign-in' || purpose.store !== store || purpose.marketplace !== marketplace) {
      throw new HttpError(404, 'That browser view is closed; start signing in again');
    }
    const html = await session.html();
    const account = amazonAccount(html);
    if (account.signedIn !== true) {
      // Keep the page's navigation bar, to see how this store marks a signed-in page when detection misses it
      const $ = cheerio.load(html);
      const nav = $('#navbar-main, #navbar, header').first();
      const file = path.join(tmpdir(), `price-tracker-signin-${store}-${marketplace}.html`);
      await writeFile(file, nav.length ? $.html(nav) : html.slice(0, 200_000)).catch(() => {});
      log.warn('sign-in not detected; the navigation bar was saved for a look', { store, marketplace, signedIn: account.signedIn, file });
      throw new HttpError(
        409,
        account.signedIn === false
          ? "Amazon doesn't show you as signed in yet. Finish signing in until the page greets you by name, then save."
          : "Finish signing in first: once you're back on a normal Amazon page that greets you by name, press \"I'm signed in\".",
      );
    }
    const userAgent = await session.userAgent();
    await sessions.save(store, marketplace, await session.browserState(), userAgent, account.accountName);

    // Amazon may sign you in to its other stores with the same account when you visit them. Check the
    // store's other marketplaces (not already signed in), one home page each, in this same browser; stop at
    // the first that doesn't take it, so stores that don't share sign-ins cost one page.
    const active = new Set((await sessions.list(catalog.get())).filter((s) => s.store === store && s.status === 'active').map((s) => s.marketplace));
    const others = catalog.marketplacesOf(store).filter((m) => !active.has(m.id));
    const checked: string[] = [];
    const alsoSignedIn: string[] = [];
    for (const other of others) {
      checked.push(other.id);
      let page: string;
      try {
        page = await session.peek(homeUrl(other));
      } catch (err) {
        log.warn('could not check another marketplace for the sign-in', { marketplace: other.id, error: err });
        break;
      }
      const there = amazonAccount(page);
      if (there.signedIn !== true) {
        // Keep that page's navigation bar, to tell "Amazon didn't sign you in" from a detection miss
        const $ = cheerio.load(page);
        const nav = $('#navbar-main, #navbar, header').first();
        const file = path.join(tmpdir(), `price-tracker-signin-check-${store}-${other.id}.html`);
        await writeFile(file, nav.length ? $.html(nav) : page.slice(0, 200_000)).catch(() => {});
        log.info('sign-in not carried over', { store, marketplace: other.id, signedIn: there.signedIn, file });
        break;
      }
      await sessions.save(store, other.id, await session.browserState(), userAgent, there.accountName ?? account.accountName);
      alsoSignedIn.push(other.id);
    }
    log.info('signed in', { store, marketplace, alsoSignedIn: alsoSignedIn.join(',') || undefined });

    await session.close('Signed in');
    res.json({ sessions: await sessions.list(catalog.get()), alsoSignedIn, checked } satisfies SignInResult);
  });

  r.delete('/store-sessions/:store/:marketplace', async (req, res) => {
    await sessions.remove(String(req.params.store), String(req.params.marketplace));
    res.json(await sessions.list(catalog.get()));
  });

  return r;
}
