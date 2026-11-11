import { existsSync } from 'node:fs';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.ts';
import { settings } from './schema.ts';

/** drizzle/ sits next to src/ in development and is copied next to the bundle in dist/. */
function migrationsFolder(): string {
  const candidates = [
    path.resolve(import.meta.dirname, '../../drizzle'),
    path.resolve(import.meta.dirname, '../drizzle'),
    path.resolve(import.meta.dirname, 'drizzle'),
  ];
  const found = candidates.find((p) => existsSync(path.join(p, 'meta/_journal.json')));
  if (!found) throw new Error(`Migrations not found; looked in ${candidates.join(', ')}`);
  return found;
}

export async function migrateAndSeed(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
}
