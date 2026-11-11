import { Router } from 'express';
import { z } from 'zod';
import { ChangePasswordBody, PasswordBody } from '@price-tracker/shared';
import type { AuthState } from '@price-tracker/shared';
import { accountExists, createAccount, passwordHash } from '../auth/account.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { currentSession, endAllSessions, endSession, startSession } from '../auth/sessions.ts';
import { clearLoginFailures, loginBlockedFor, recordLoginFailure } from '../auth/throttle.ts';
import type { Db } from '../db/client.ts';
import { appAccount } from '../db/schema.ts';
import { HttpError, validate } from '../http/errors.ts';

// Signing in checks any password length; only new passwords must be 8+ characters
const LoginBody = z.object({ password: z.string().min(1, 'Enter the password').max(200) });

export function authRoutes(db: Db): Router {
  const r = Router();
  const state = (authenticated: boolean, setupRequired: boolean): AuthState => ({ authenticated, setupRequired });

  r.get('/state', async (req, res) => {
    const exists = await accountExists(db);
    res.json(state(exists && !!(await currentSession(db, req, res)), !exists));
  });

  r.post('/setup', async (req, res) => {
    const { password } = validate(PasswordBody, req.body);
    if (!(await createAccount(db, password))) throw new HttpError(409, 'The account already exists; sign in instead');
    await startSession(db, req, res);
    res.json(state(true, false));
  });

  r.post('/login', async (req, res) => {
    const ip = req.ip ?? 'unknown';
    const wait = loginBlockedFor(ip);
    if (wait) throw new HttpError(429, `Too many failed attempts; try again in ${Math.ceil(wait / 60)} min`);
    const { password } = validate(LoginBody, req.body);
    const hash = await passwordHash(db);
    if (!hash) throw new HttpError(409, 'No account yet; set a password first');
    if (!(await verifyPassword(password, hash))) {
      recordLoginFailure(ip);
      throw new HttpError(401, 'Wrong password');
    }
    clearLoginFailures(ip);
    await startSession(db, req, res);
    res.json(state(true, false));
  });

  r.post('/logout', async (req, res) => {
    await endSession(db, req, res);
    res.json(state(false, !(await accountExists(db))));
  });

  r.post('/password', async (req, res) => {
    const session = await currentSession(db, req, res);
    if (!session) throw new HttpError(401, 'Not signed in');
    const { currentPassword, newPassword } = validate(ChangePasswordBody, req.body);
    const hash = await passwordHash(db);
    if (!hash || !(await verifyPassword(currentPassword, hash))) throw new HttpError(400, 'The current password is wrong');
    await db.update(appAccount).set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() });
    await endAllSessions(db, session);
    res.json(state(true, false));
  });

  return r;
}
