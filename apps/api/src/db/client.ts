import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { log } from '../log.ts';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  // An idle connection the server drops (Postgres restarting, e.g. during nixos-rebuild switch) emits
  // 'error' on the pool; unhandled, that would kill the process. The pool discards it and the next
  // query opens a new connection.
  pool.on('error', (err) => log.warn('database connection lost', { error: err }));
  const db = drizzle(pool, { schema });
  return { db, pool };
}
