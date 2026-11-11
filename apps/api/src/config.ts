import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const Env = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required, e.g. postgres://user:pass@host/db or postgres:///price_tracker?host=/run/postgresql'),
  HOST: z.string().default('127.0.0.1'),
  /** Not 3000: that one is often taken by other dev servers. */
  PORT: z.coerce.number().int().positive().default(4380),
  /** Built web app to serve. Defaults to apps/web/dist next to this package, when it exists. */
  WEB_DIST: z.string().optional(),
  /** Run scheduled checks and housekeeping. Off for tests and one-off CLI runs. */
  CHECKS_ENABLED: bool.default(true),
  /** Let shop links and the live browser reach local and private addresses. Only for tests and development. */
  ALLOW_PRIVATE_HOSTS: bool.default(false),
  /** Encrypts saved store sign-ins (32 random bytes, base64: openssl rand -base64 32). Needed to sign in to stores. */
  SESSION_KEY: z
    .string()
    .refine((k) => Buffer.from(k, 'base64').length === 32, 'SESSION_KEY must be 32 bytes, base64 (openssl rand -base64 32)')
    .optional(),
  /** If both are set and no notification channel exists yet, a Gotify channel is created from them. */
  GOTIFY_URL: z.string().optional(),
  GOTIFY_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof Env> & { webDist: string | null };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const candidates = [
    parsed.data.WEB_DIST,
    path.resolve(import.meta.dirname, '../../web/dist'), // src/ in development
    path.resolve(import.meta.dirname, '../web'), // bundled dist/ with the web build copied next to it
  ];
  const webDist = candidates.find((p) => p && existsSync(path.join(p, 'index.html'))) ?? null;
  return { ...parsed.data, webDist };
}
