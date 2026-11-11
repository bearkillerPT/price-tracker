import { Router } from 'express';
import { count, eq } from 'drizzle-orm';
import { CustomStoreCreate, CustomStoreUpdate, SelectorTestBody, storeIdFromHost, StorePreviewBody } from '@price-tracker/shared';
import type { CatalogService } from '../catalog.ts';
import type { Db } from '../db/client.ts';
import { customStores, listings, storeState } from '../db/schema.ts';
import { HttpError, validate } from '../http/errors.ts';
import type { Previewer } from '../stores/preview.ts';
import { parseProductUrl, toUrl } from '../stores/registry.ts';

export function customStoreRoutes(db: Db, catalog: CatalogService, previewer: Previewer, wake: (group: string) => void): Router {
  const r = Router();

  r.get('/catalog', (_req, res) => {
    res.json(catalog.get());
  });

  // One request to an unknown shop's product page, to see whether it can be tracked
  r.post('/custom-stores/preview', async (req, res) => {
    const { url: raw } = validate(StorePreviewBody, req.body);
    const parsed = parseProductUrl(raw, catalog.get());
    if (parsed.kind === 'invalid') throw new HttpError(422, parsed.reason);
    if (parsed.kind === 'known') throw new HttpError(409, `${catalog.store(parsed.store)?.label ?? parsed.store} is already set up; add the listing directly`);
    const url = toUrl(parsed.url)!;
    const wait = previewer.waitFor(url.hostname);
    if (wait) throw new HttpError(429, `Wait ${Math.ceil(wait / 1000)} s before loading another page from this shop`);
    res.json(await previewer.preview(url));
  });

  // One plain load of a page with a picked price selector: works without a browser, or needs one?
  r.post('/custom-stores/test-selector', async (req, res) => {
    const { url: raw, selector } = validate(SelectorTestBody, req.body);
    const parsed = parseProductUrl(raw, catalog.get());
    if (parsed.kind === 'invalid') throw new HttpError(422, parsed.reason);
    // A listing's own address (re-picking) can differ from its canonical form, e.g. while testing locally
    const url = toUrl(parsed.kind === 'known' ? raw : parsed.url)!;
    // Right after a preview the page is read again from memory: no request, so no wait
    const wait = previewer.hasRecentPage(url) ? 0 : previewer.waitFor(url.hostname);
    if (wait) throw new HttpError(429, `Wait ${Math.ceil(wait / 1000)} s before loading another page from this shop`);
    res.json(await previewer.testSelector(url, selector));
  });

  r.post('/custom-stores', async (req, res) => {
    const body = validate(CustomStoreCreate, req.body);
    const id = storeIdFromHost(body.host);
    if (catalog.store(id)) throw new HttpError(409, `${catalog.store(id)!.label} is already set up`);
    if (parseProductUrl(`https://${body.host}/`, catalog.get()).kind === 'invalid') throw new HttpError(422, 'This shop needs its own support and can\'t be added as a custom store');
    await db.insert(customStores).values({
      id,
      host: body.host,
      label: body.label,
      currency: body.currency,
      defaultIntervalMinutes: body.defaultIntervalMinutes,
      priceSelector: body.priceSelector ?? null,
      fetchMethod: body.fetchMethod,
    });
    await catalog.refresh();
    wake(id);
    res.status(201).json(catalog.get());
  });

  r.patch('/custom-stores/:id', async (req, res) => {
    const body = validate(CustomStoreUpdate, req.body);
    const updated = await db.update(customStores).set(body).where(eq(customStores.id, String(req.params.id))).returning({ id: customStores.id });
    if (!updated.length) throw new HttpError(404, 'Store not found');
    res.json(await catalog.refresh());
  });

  r.delete('/custom-stores/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!catalog.store(id)?.custom) throw new HttpError(404, 'Store not found');
    const [{ n }] = (await db.select({ n: count() }).from(listings).where(eq(listings.store, id))) as [{ n: number }];
    if (n > 0) throw new HttpError(409, n === 1 ? '1 listing still uses this store; delete it first' : `${n} listings still use this store; delete them first`);
    await db.delete(customStores).where(eq(customStores.id, id));
    await db.delete(storeState).where(eq(storeState.rateGroup, id));
    res.json(await catalog.refresh());
  });

  return r;
}
