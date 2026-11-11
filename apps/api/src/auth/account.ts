import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { appAccount } from '../db/schema.ts';
import { hashPassword } from './password.ts';
import { endAllSessions } from './sessions.ts';

export async function accountExists(db: Db): Promise<boolean> {
  return (await db.select({ id: appAccount.id }).from(appAccount)).length > 0;
}

export async function passwordHash(db: Db): Promise<string | null> {
  const [a] = await db.select({ passwordHash: appAccount.passwordHash }).from(appAccount).where(eq(appAccount.id, 1));
  return a?.passwordHash ?? null;
}

/** Creates the account only if none exists. False when one already did. */
export async function createAccount(db: Db, password: string): Promise<boolean> {
  const rows = await db
    .insert(appAccount)
    .values({ id: 1, passwordHash: await hashPassword(password) })
    .onConflictDoNothing()
    .returning({ id: appAccount.id });
  return rows.length > 0;
}

/** Sets the password (creating the account if needed) and ends every login session. Products, listings and history are untouched. */
export async function resetPassword(db: Db, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await db
    .insert(appAccount)
    .values({ id: 1, passwordHash: hash })
    .onConflictDoUpdate({ target: appAccount.id, set: { passwordHash: hash, updatedAt: new Date() } });
  await endAllSessions(db);
}
