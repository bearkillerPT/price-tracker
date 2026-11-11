// Runs due checks. One loop per rate group, one check at a time, with a random pause between checks to
// the same group, so a store never sees a burst of requests.
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { listings, products, storeState } from '../db/schema.ts';
import { log } from '../log.ts';
import type { CatalogService } from '../catalog.ts';
import { adapterFor } from '../stores/registry.ts';

export interface SchedulerOptions {
  /** Pause between two checks to the same group. Not shortened by wake(). */
  gapMs?: () => number;
  /** Longest sleep before looking for due checks again. */
  idleMs?: number;
}

export class Scheduler {
  private stopping = new AbortController();
  private wakers = new Map<string, () => void>();
  private loops = new Map<string, Promise<void>>();
  private started = false;
  private readonly gapMs: () => number;
  private readonly idleMs: number;

  constructor(
    private db: Db,
    private catalog: CatalogService,
    private runCheck: (listingId: number) => Promise<void>,
    options: SchedulerOptions = {},
  ) {
    this.gapMs = options.gapMs ?? (() => 20_000 + Math.random() * 25_000);
    this.idleMs = options.idleMs ?? 60_000;
  }

  start(): void {
    this.started = true;
    for (const group of this.catalog.get().rateGroups) this.ensureLoop(group.id);
  }

  async stop(): Promise<void> {
    this.stopping.abort();
    await Promise.all(this.loops.values());
  }

  /**
   * Look for due checks now (after a listing was added or "check now"), unless in the pause between checks.
   * A new custom store's group gets its loop here.
   */
  wake(group: string): void {
    if (!this.started) return;
    this.ensureLoop(group);
    this.wakers.get(group)?.();
  }

  /** The stores of a group that can be checked right now (catalog changes are picked up on each turn). */
  private checkableStores(group: string): string[] {
    const catalog = this.catalog.get();
    return (this.catalog.rateGroup(group)?.stores ?? []).filter((s) => adapterFor(s, catalog));
  }

  private ensureLoop(group: string): void {
    if (this.loops.has(group) || this.stopping.signal.aborted || !this.checkableStores(group).length) return;
    this.loops.set(group, this.loop(group));
  }

  private sleep(ms: number, group?: string): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.stopping.signal.removeEventListener('abort', done);
        if (group && this.wakers.get(group) === done) this.wakers.delete(group);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      this.stopping.signal.addEventListener('abort', done);
      if (group) this.wakers.set(group, done);
    });
  }

  private async loop(group: string): Promise<void> {
    log.info('scheduler started', { group, stores: this.checkableStores(group).join(',') });
    while (!this.stopping.signal.aborted) {
      try {
        const stores = this.checkableStores(group);
        if (!stores.length) {
          await this.sleep(this.idleMs, group);
          continue;
        }
        const now = Date.now();
        const [state] = await this.db.select().from(storeState).where(eq(storeState.rateGroup, group));
        if (state?.pausedUntil && state.pausedUntil.getTime() > now) {
          await this.sleep(Math.min(state.pausedUntil.getTime() - now, this.idleMs), group);
          continue;
        }
        const [next] = await this.db
          .select({ id: listings.id, nextCheckAt: listings.nextCheckAt })
          .from(listings)
          .innerJoin(products, eq(listings.productId, products.id))
          .where(and(eq(listings.enabled, true), eq(products.archived, false), inArray(listings.store, stores)))
          .orderBy(asc(listings.nextCheckAt))
          .limit(1);
        if (!next) {
          await this.sleep(this.idleMs, group);
          continue;
        }
        const wait = next.nextCheckAt.getTime() - now;
        if (wait > 0) {
          await this.sleep(Math.min(wait, this.idleMs), group);
          continue;
        }
        await this.runCheck(next.id);
        await this.sleep(this.gapMs());
      } catch (err) {
        log.error('scheduler error', { group, error: err });
        await this.sleep(30_000);
      }
    }
  }
}

