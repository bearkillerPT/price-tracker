import { createHash, randomBytes } from 'node:crypto';
import { eq, ne } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type { Db } from '../db/client.ts';
import { appSessions } from '../db/schema.ts';

const COOKIE = 'pt_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions slide forward at most this often, to avoid a write on every request. */
const SLIDE_MS = 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function cookieFromHeader(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const readCookie = (req: Request, name: string): string | null => cookieFromHeader(req.headers.cookie, name);

/** Whether a Cookie header carries a valid login session (for WebSocket handshakes, which skip Express). */
export async function validSessionCookie(db: Db, cookieHeader: string | undefined): Promise<boolean> {
  const token = cookieFromHeader(cookieHeader, COOKIE);
  if (!token) return false;
  const [s] = await db.select({ expiresAt: appSessions.expiresAt }).from(appSessions).where(eq(appSessions.tokenHash, hash(token)));
  return !!s && s.expiresAt.getTime() > Date.now();
}

function setCookie(req: Request, res: Response, token: string | null): void {
  res.cookie(COOKIE, token ?? '', {
    httpOnly: true,
    sameSite: 'lax',
    // req.secure is true behind nginx with TLS, since the app trusts the loopback proxy
    secure: req.secure,
    path: '/',
    maxAge: token ? TTL_MS : 0,
  });
}

export async function startSession(db: Db, req: Request, res: Response): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(appSessions).values({ tokenHash: hash(token), expiresAt: new Date(Date.now() + TTL_MS) });
  setCookie(req, res, token);
}

/** The current session's token hash, or null. Slides the expiry forward. */
export async function currentSession(db: Db, req: Request, res: Response): Promise<string | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const tokenHash = hash(token);
  const [s] = await db.select().from(appSessions).where(eq(appSessions.tokenHash, tokenHash));
  const now = Date.now();
  if (!s || s.expiresAt.getTime() <= now) return null;
  if (now - s.lastSeenAt.getTime() > SLIDE_MS) {
    await db.update(appSessions).set({ lastSeenAt: new Date(now), expiresAt: new Date(now + TTL_MS) }).where(eq(appSessions.tokenHash, tokenHash));
    setCookie(req, res, token);
  }
  return tokenHash;
}

export async function endSession(db: Db, req: Request, res: Response): Promise<void> {
  const token = readCookie(req, COOKIE);
  if (token) await db.delete(appSessions).where(eq(appSessions.tokenHash, hash(token)));
  setCookie(req, res, null);
}

/** Ends every session, or every session but one. */
export async function endAllSessions(db: Db, keepTokenHash?: string): Promise<void> {
  await db.delete(appSessions).where(keepTokenHash ? ne(appSessions.tokenHash, keepTokenHash) : undefined);
}
