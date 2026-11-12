import { Router } from 'express';
import { eq } from 'drizzle-orm';
import {
  AlertRuleCreate,
  AlertRuleUpdate,
  ListingCreate,
  ListingUpdate,
  ParseUrlBody,
  ProductCreate,
  ProductUpdate,
} from '@price-tracker/shared';
import type { ParseUrlResult } from '@price-tracker/shared';
import type { CatalogService } from '../catalog.ts';
import type { CheckRunner } from '../checks/run-check.ts';
import type { Db } from '../db/client.ts';
import { alertRules, listings, products } from '../db/schema.ts';
import { HttpError, idParam, validate } from '../http/errors.ts';
import type { Previewer } from '../stores/preview.ts';
import { adapterFor, canonicalUrlFor, parseProductUrl } from '../stores/registry.ts';
import type { StoreIcons } from '../stores/icons.ts';
import { loadHistory, loadProductDetail, loadProductDetails, toSummary } from '../views/products.ts';

export interface ProductRouteDeps {
  db: Db;
  catalog: CatalogService;
  /** Tells the scheduler new checks may be due. */
  wake: (group: string) => void;
  /** A fresh preview of a custom store's page becomes the new listing's first check. */
  previewer: Previewer;
  recordOutcome: CheckRunner['recordOutcome'];
  /** Learns a new store's icon from the page its preview loaded. */
  icons: StoreIcons;
}

export function productRoutes({ db, catalog, wake, previewer, recordOutcome, icons }: ProductRouteDeps): Router {
  const r = Router();

  const detail = async (id: number) => {
    const p = await loadProductDetail(db, id);
    if (!p) throw new HttpError(404, 'Product not found');
    return p;
  };
  const listingOrThrow = async (id: number) => {
    const [l] = await db.select().from(listings).where(eq(listings.id, id));
    if (!l) throw new HttpError(404, 'Listing not found');
    return l;
  };
  const wakeFor = (store: string) => {
    const group = catalog.store(store)?.rateGroup;
    if (group) wake(group);
  };

  // ---- Products ----

  r.get('/products', async (_req, res) => {
    res.json((await loadProductDetails(db)).map(toSummary));
  });

  r.post('/products', async (req, res) => {
    const body = validate(ProductCreate, req.body);
    const [p] = await db
      .insert(products)
      .values({ name: body.name, ean: body.ean ?? null, notes: body.notes ?? null, acceptedConditions: body.acceptedConditions })
      .returning({ id: products.id });
    res.status(201).json(await detail(p!.id));
  });

  r.get('/products/:id', async (req, res) => {
    res.json(await detail(idParam(req.params.id)));
  });

  r.patch('/products/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = validate(ProductUpdate, req.body);
    const updated = await db
      .update(products)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning({ id: products.id });
    if (!updated.length) throw new HttpError(404, 'Product not found');
    res.json(await detail(id));
  });

  r.delete('/products/:id', async (req, res) => {
    const deleted = await db.delete(products).where(eq(products.id, idParam(req.params.id))).returning({ id: products.id });
    if (!deleted.length) throw new HttpError(404, 'Product not found');
    res.json({ ok: true });
  });

  r.get('/products/:id/history', async (req, res) => {
    const id = idParam(req.params.id);
    await detail(id);
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 3650);
    res.json(await loadHistory(db, id, days));
  });

  // ---- Listings ----

  r.post('/listings/parse-url', async (req, res) => {
    const { url } = validate(ParseUrlBody, req.body);
    const parsed = parseProductUrl(url, catalog.get());
    if (parsed.kind === 'invalid') throw new HttpError(422, parsed.reason);
    res.json(parsed satisfies ParseUrlResult);
  });

  r.post('/products/:id/listings', async (req, res) => {
    const productId = idParam(req.params.id);
    await detail(productId);
    const body = validate(ListingCreate, req.body);
    const store = catalog.store(body.store);
    if (!store) throw new HttpError(422, `Unknown store "${body.store}"`);
    const adapter = adapterFor(body.store, catalog.get());
    if (!adapter) throw new HttpError(422, `${store.label} isn't supported yet`);
    const externalId = adapter.normalizeExternalId(body.externalId);
    if (!externalId) throw new HttpError(422, `That isn't a valid ${store.externalIdLabel}`);

    const values = body.marketplaces.map((marketplace) => {
      const url = canonicalUrlFor(catalog.get(), body.store, marketplace, externalId);
      if (!url) throw new HttpError(422, `${marketplace} isn't a ${store.label} marketplace`);
      return {
        productId,
        store: body.store,
        marketplace,
        externalId,
        url,
        condition: body.condition,
        intervalMinutes: body.intervalMinutes ?? store.defaultIntervalMinutes,
        guardInclude: body.guardInclude,
        guardExclude: body.guardExclude,
        nextCheckAt: new Date(),
      };
    });
    const inserted = await db.insert(listings).values(values).onConflictDoNothing().returning({ id: listings.id, url: listings.url });
    if (!inserted.length) throw new HttpError(409, 'This product is already tracked in those marketplaces');
    // Just previewed this page? That request counts as the first check instead of making another
    for (const l of inserted) {
      const preview = await previewer.take(l.url, { guardInclude: body.guardInclude, guardExclude: body.guardExclude });
      if (preview) await recordOutcome(l.id, preview.outcome, preview.at);
      const page = previewer.recentPage(l.url);
      if (page) void icons.learn(body.store, page);
    }
    wakeFor(body.store);
    res.status(201).json(await detail(productId));
  });

  r.patch('/listings/:id', async (req, res) => {
    const listing = await listingOrThrow(idParam(req.params.id));
    const body = validate(ListingUpdate, req.body);
    const intervalMinutes = body.intervalMinutes ?? listing.intervalMinutes;
    // Re-plan the next check from the last one, so a shorter interval or re-enabling takes effect now
    const nextCheckAt = listing.lastCheckedAt ? new Date(listing.lastCheckedAt.getTime() + intervalMinutes * 60_000) : new Date();
    await db.update(listings).set({ ...body, nextCheckAt }).where(eq(listings.id, listing.id));
    wakeFor(listing.store);
    res.json(await detail(listing.productId));
  });

  r.delete('/listings/:id', async (req, res) => {
    const listing = await listingOrThrow(idParam(req.params.id));
    await db.delete(listings).where(eq(listings.id, listing.id));
    res.json(await detail(listing.productId));
  });

  r.post('/listings/:id/check', async (req, res) => {
    const listing = await listingOrThrow(idParam(req.params.id));
    if (!listing.enabled) throw new HttpError(409, 'This listing is disabled');
    await db.update(listings).set({ nextCheckAt: new Date() }).where(eq(listings.id, listing.id));
    wakeFor(listing.store);
    res.json(await detail(listing.productId));
  });

  // ---- Alert rules ----

  r.post('/products/:id/alerts', async (req, res) => {
    const productId = idParam(req.params.id);
    await detail(productId);
    const body = validate(AlertRuleCreate, req.body);
    await db.insert(alertRules).values({ productId, type: body.type, threshold: body.threshold ?? null });
    res.status(201).json(await detail(productId));
  });

  r.patch('/alerts/:id', async (req, res) => {
    const body = validate(AlertRuleUpdate, req.body);
    const [rule] = await db.update(alertRules).set(body).where(eq(alertRules.id, idParam(req.params.id))).returning({ productId: alertRules.productId });
    if (!rule) throw new HttpError(404, 'Alert not found');
    res.json(await detail(rule.productId));
  });

  r.delete('/alerts/:id', async (req, res) => {
    const [rule] = await db.delete(alertRules).where(eq(alertRules.id, idParam(req.params.id))).returning({ productId: alertRules.productId });
    if (!rule) throw new HttpError(404, 'Alert not found');
    res.json(await detail(rule.productId));
  });

  return r;
}
