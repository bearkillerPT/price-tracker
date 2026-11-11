import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

// scrypt from node:crypto: no native module to build on the Pi. ~32 MiB and ~100-200 ms per hash there.
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_MEM = 64 * 1024 * 1024;

const derive = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, keyLength, { ...options, maxmem: MAX_MEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );

/** "scrypt$N$r$p$salt$key", salt and key in base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
