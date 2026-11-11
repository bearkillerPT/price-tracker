// Store sign-ins made in the live browser. The browser's state (cookies and local storage) is kept
// encrypted; checks load its cookies into an HTTP cookie jar, send them with the user agent of the
// browser that signed in, and save the cookies the store renews. Reopening the live browser for a store
// starts from the saved state, so the store recognises the device.
import { and, count, eq } from 'drizzle-orm';
import { Cookie, CookieJar, MemoryCookieStore } from 'tough-cookie';
import { marketplacesOfStore } from '@price-tracker/shared';
import type { Catalog, StoreSessionStatus } from '@price-tracker/shared';
import { open, seal } from '../auth/secret-box.ts';
import type { Db } from '../db/client.ts';
import { listings, storeSessions } from '../db/schema.ts';
import { log } from '../log.ts';

/** Playwright's storageState: what the live browser hands over and gets back. */
export interface BrowserState {
  cookies: BrowserCookie[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds; -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface ActiveSession {
  jar: CookieJar;
  userAgent: string;
  /** Saves the cookies the store set during the check. */
  persist(): Promise<void>;
  /** Marks the session expired; true if it was active until now. */
  expire(): Promise<boolean>;
}

const SAME_SITE: Record<string, BrowserCookie['sameSite']> = { strict: 'Strict', lax: 'Lax', none: 'None' };

export function toJarCookie(c: BrowserCookie): Cookie {
  return new Cookie({
    key: c.name,
    value: c.value,
    domain: c.domain.replace(/^\./, ''),
    hostOnly: !c.domain.startsWith('.'),
    path: c.path,
    expires: c.expires > 0 ? new Date(c.expires * 1000) : 'Infinity',
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite.toLowerCase(),
  });
}

export function toBrowserCookie(c: Cookie): BrowserCookie {
  return {
    name: c.key,
    value: c.value,
    domain: c.hostOnly ? (c.domain ?? '') : `.${c.domain}`,
    path: c.path ?? '/',
    expires: c.expires instanceof Date ? Math.floor(c.expires.getTime() / 1000) : -1,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: SAME_SITE[String(c.sameSite).toLowerCase()] ?? 'Lax',
  };
}

export async function jarFromState(state: BrowserState): Promise<{ jar: CookieJar; store: MemoryCookieStore }> {
  const store = new MemoryCookieStore();
  for (const c of state.cookies) await store.putCookie(toJarCookie(c));
  return { jar: new CookieJar(store), store };
}

export class StoreSessions {
  constructor(
    private db: Db,
    private key: string | undefined,
    private now: () => Date = () => new Date(),
  ) {}

  /** Sign-ins can only be kept with SESSION_KEY set. */
  get enabled(): boolean {
    return !!this.key;
  }

  async list(catalog: Catalog): Promise<StoreSessionStatus[]> {
    const rows = await this.db.select().from(storeSessions);
    const counts = await this.db
      .select({ store: listings.store, marketplace: listings.marketplace, n: count() })
      .from(listings)
      .where(eq(listings.enabled, true))
      .groupBy(listings.store, listings.marketplace);
    return catalog.stores
      .filter((s) => s.canSignIn && s.implemented)
      .flatMap((s) => marketplacesOfStore(catalog, s.id))
      .map((m): StoreSessionStatus => {
        const row = rows.find((r) => r.store === m.store && r.marketplace === m.id);
        return {
          store: m.store,
          marketplace: m.id,
          status: (row?.status as StoreSessionStatus['status']) ?? 'none',
          accountName: row?.accountName ?? null,
          listingCount: counts.find((c) => c.store === m.store && c.marketplace === m.id)?.n ?? 0,
          signedInAt: row?.signedInAt.toISOString() ?? null,
          lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
          expiredAt: row?.expiredAt?.toISOString() ?? null,
        };
      });
  }

  async save(store: string, marketplace: string, state: BrowserState, userAgent: string, accountName: string | null): Promise<void> {
    const stateEncrypted = seal(JSON.stringify(state), this.requireKey());
    const at = this.now();
    await this.db
      .insert(storeSessions)
      .values({ store, marketplace, stateEncrypted, userAgent, accountName, status: 'active', signedInAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: [storeSessions.store, storeSessions.marketplace],
        set: { stateEncrypted, userAgent, accountName, status: 'active', signedInAt: at, expiredAt: null, updatedAt: at },
      });
  }

  /** The saved browser state, active or expired, to reopen the live browser with. */
  async state(store: string, marketplace: string): Promise<BrowserState | null> {
    const [row] = await this.db.select().from(storeSessions).where(and(eq(storeSessions.store, store), eq(storeSessions.marketplace, marketplace)));
    return row ? this.decrypt(row.stateEncrypted) : null;
  }

  async remove(store: string, marketplace: string): Promise<void> {
    await this.db.delete(storeSessions).where(and(eq(storeSessions.store, store), eq(storeSessions.marketplace, marketplace)));
  }

  /** The active session for a check, or null. */
  async active(store: string, marketplace: string): Promise<ActiveSession | null> {
    if (!this.key) return null;
    const where = and(eq(storeSessions.store, store), eq(storeSessions.marketplace, marketplace));
    const [row] = await this.db.select().from(storeSessions).where(and(where, eq(storeSessions.status, 'active')));
    if (!row) return null;
    const state = this.decrypt(row.stateEncrypted);
    if (!state) return null;
    const { jar, store: cookies } = await jarFromState(state);
    return {
      jar,
      userAgent: row.userAgent,
      persist: async () => {
        const updated: BrowserState = { ...state, cookies: (await cookies.getAllCookies()).map(toBrowserCookie) };
        const at = this.now();
        await this.db
          .update(storeSessions)
          .set({ stateEncrypted: seal(JSON.stringify(updated), this.requireKey()), lastUsedAt: at, updatedAt: at })
          .where(and(where, eq(storeSessions.status, 'active')));
      },
      expire: async () => {
        const at = this.now();
        const changed = await this.db
          .update(storeSessions)
          .set({ status: 'expired', expiredAt: at, lastUsedAt: at, updatedAt: at })
          .where(and(where, eq(storeSessions.status, 'active')))
          .returning({ id: storeSessions.id });
        return changed.length > 0;
      },
    };
  }

  private requireKey(): string {
    if (!this.key) throw new Error('SESSION_KEY is not set');
    return this.key;
  }

  private decrypt(sealed: string): BrowserState | null {
    try {
      return JSON.parse(open(sealed, this.requireKey())) as BrowserState;
    } catch (err) {
      log.warn('saved sign-in unreadable (SESSION_KEY changed?)', { error: err });
      return null;
    }
  }
}
