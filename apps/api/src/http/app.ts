import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { currentSession } from '../auth/sessions.ts';
import type { LiveSessions } from '../browser/live.ts';
import type { CatalogService } from '../catalog.ts';
import type { CheckRunner } from '../checks/run-check.ts';
import type { Db } from '../db/client.ts';
import { authRoutes } from '../routes/auth.ts';
import { browserRoutes } from '../routes/browser.ts';
import { customStoreRoutes } from '../routes/custom-stores.ts';
import { notificationRoutes } from '../routes/notifications.ts';
import { productRoutes } from '../routes/products.ts';
import { settingsRoutes } from '../routes/settings.ts';
import { storeSessionRoutes } from '../routes/store-sessions.ts';
import type { HomeUrl } from '../routes/store-sessions.ts';
import { storeRoutes } from '../routes/stores.ts';
import type { Previewer } from '../stores/preview.ts';
import type { StoreSessions } from '../stores/sessions.ts';
import type { StoreIcons } from '../stores/icons.ts';
import { errorHandler, HttpError } from './errors.ts';

export interface AppDeps {
  db: Db;
  catalog: CatalogService;
  /** Tells the scheduler that a rate group may have due checks. */
  wake: (group: string) => void;
  previewer: Previewer;
  recordOutcome: CheckRunner['recordOutcome'];
  /** The live browser (Chromium on the server, streamed to the UI). */
  liveSessions: LiveSessions;
  /** Store sign-ins kept from the live browser. */
  storeSessions: StoreSessions;
  /** Store favicons. */
  storeIcons: StoreIcons;
  /** Where a marketplace's home page is (tests serve fake ones). */
  storeHomeUrl?: HomeUrl;
  /** Built web app to serve, or null to serve only the API. */
  webDist: string | null;
}

export function createApp({ db, catalog, wake, previewer, recordOutcome, liveSessions, storeSessions, storeIcons, storeHomeUrl, webDist }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // nginx runs on the same host: trust it for the client IP and for HTTPS (secure cookies)
  app.set('trust proxy', 'loopback');

  app.use((_req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  // Cookies are SameSite=Lax; also refuse state changes a browser marks as coming from another site
  api.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('sec-fetch-site') === 'cross-site') {
      next(new HttpError(403, 'Cross-site requests are not allowed'));
      return;
    }
    next();
  });
  api.get('/health', async (_req, res) => {
    await db.execute(sql`select 1`);
    res.json({ ok: true });
  });
  api.use('/auth', authRoutes(db));
  api.use(async (req: Request, res: Response, next: NextFunction) => {
    if (await currentSession(db, req, res)) next();
    else next(new HttpError(401, 'Not signed in'));
  });
  api.use(productRoutes({ db, catalog, wake, previewer, recordOutcome, icons: storeIcons }));
  api.use(storeRoutes(db, catalog, wake, storeIcons));
  api.use(customStoreRoutes(db, catalog, previewer, wake, storeIcons));
  api.use(browserRoutes(liveSessions));
  api.use(storeSessionRoutes(catalog, storeSessions, liveSessions, storeHomeUrl));
  api.use(notificationRoutes(db));
  api.use(settingsRoutes(db));
  api.use((_req, _res, next) => next(new HttpError(404, 'No such API route')));
  api.use(errorHandler);
  app.use('/api', api);

  if (webDist) {
    // Hashed asset names never change, so they can be cached for good
    app.use('/assets', express.static(path.join(webDist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
    app.use(express.static(webDist, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('cache-control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }
  return app;
}
