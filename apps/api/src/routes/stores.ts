import { Router } from 'express';
import { and, eq, gt, sql } from 'drizzle-orm';
import { requestsPerHour, storeIn } from '@price-tracker/shared';
import type { Catalog, ObservationStatus, RateGroupStatus } from '@price-tracker/shared';
import type { CatalogService } from '../catalog.ts';
import type { Db } from '../db/client.ts';
import { listings, observations, products, storeState } from '../db/schema.ts';
import { HttpError } from '../http/errors.ts';
import type { StoreIcons } from '../stores/icons.ts';

export async function rateGroupStatuses(db: Db, catalog: Catalog, now = new Date()): Promise<RateGroupStatus[]> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [enabled, recent, states] = await Promise.all([
    db
      .select({ store: listings.store, intervalMinutes: listings.intervalMinutes })
      .from(listings)
      .innerJoin(products, eq(listings.productId, products.id))
      .where(and(eq(listings.enabled, true), eq(products.archived, false))),
    db
      .select({ store: observations.store, status: observations.status, requests: sql<number>`sum(${observations.requestCount})::int` })
      .from(observations)
      .where(gt(observations.checkedAt, hourAgo))
      .groupBy(observations.store, observations.status),
    db.select().from(storeState),
  ]);

  return catalog.rateGroups.map((info): RateGroupStatus => {
    const group = info.id;
    const inGroup = (store: string) => info.stores.includes(store);
    const own = enabled.filter((l) => inGroup(l.store));
    const plannedPerHour = Math.round(own.reduce((sum, l) => sum + requestsPerHour(l.intervalMinutes), 0) * 100) / 100;
    const byStatus: Partial<Record<ObservationStatus, number>> = {};
    let total = 0;
    for (const row of recent.filter((r) => inGroup(r.store))) {
      const status = row.status as ObservationStatus;
      byStatus[status] = (byStatus[status] ?? 0) + row.requests;
      total += row.requests;
    }
    const state = states.find((s) => s.rateGroup === group);
    const paused = state?.pausedUntil && state.pausedUntil > now ? state : null;
    return {
      group,
      label: info.label,
      stores: info.stores,
      custom: info.stores.some((s) => storeIn(catalog, s)?.custom),
      enabledListings: own.length,
      plannedPerHour,
      actualLastHour: { total, byStatus },
      warnPerHour: info.warnPerHour,
      dangerPerHour: info.dangerPerHour,
      level: plannedPerHour >= info.dangerPerHour ? 'danger' : plannedPerHour >= info.warnPerHour ? 'warn' : 'ok',
      pausedUntil: paused?.pausedUntil?.toISOString() ?? null,
      pauseReason: paused?.pauseReason ?? null,
    };
  });
}

export function storeRoutes(db: Db, catalog: CatalogService, wake: (group: string) => void, icons: StoreIcons): Router {
  const r = Router();

  // Store icons: which stores have one (with a version for caching), and the image itself
  r.get('/store-icons', async (_req, res) => {
    res.json(await icons.versions());
  });

  r.get('/store-icons/:store', async (req, res) => {
    const icon = await icons.get(String(req.params.store));
    if (!icon) throw new HttpError(404, 'No icon for that store');
    // Addressed with ?v=<version>, so it can be cached for long
    res.set('cache-control', 'private, max-age=604800, immutable').type(icon.contentType).send(icon.data);
  });

  r.get('/stores', async (_req, res) => {
    res.json(await rateGroupStatuses(db, catalog.get()));
  });

  r.post('/stores/:group/resume', async (req, res) => {
    const group = String(req.params.group);
    if (!catalog.rateGroup(group)) throw new HttpError(404, 'Unknown store group');
    await db.update(storeState).set({ pausedUntil: null, pauseReason: null, updatedAt: new Date() }).where(eq(storeState.rateGroup, group));
    wake(group);
    res.json(await rateGroupStatuses(db, catalog.get()));
  });

  return r;
}
