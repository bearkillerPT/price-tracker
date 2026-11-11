// Encrypts saved store sign-ins at rest: AES-256-GCM with SESSION_KEY.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export function seal(plaintext: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

/** Throws when the key is wrong or the data was changed. */
export function open(sealed: string, keyBase64: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Not a sealed value');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
