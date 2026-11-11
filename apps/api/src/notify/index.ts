import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { notificationChannels } from '../db/schema.ts';
import { log } from '../log.ts';

export interface Message {
  title: string;
  message: string;
  /** Gotify priority: 0-10. */
  priority: number;
  /** Opened when the notification is tapped. */
  url?: string;
}

/** Sends to every enabled channel; true when at least one accepted it. Never throws. */
export type Notify = (message: Message) => Promise<boolean>;

type Channel = typeof notificationChannels.$inferSelect;

export async function sendToChannel(channel: Channel, m: Message): Promise<void> {
  const res = await fetch(new URL('message', channel.url.endsWith('/') ? channel.url : `${channel.url}/`), {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json', 'x-gotify-key': channel.token },
    body: JSON.stringify({
      title: m.title,
      message: m.message,
      priority: m.priority,
      ...(m.url ? { extras: { 'client::notification': { click: { url: m.url } } } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Gotify answered HTTP ${res.status}`);
}

export function createNotifier(db: Db): Notify {
  return async (m) => {
    const channels = await db.select().from(notificationChannels).where(eq(notificationChannels.enabled, true));
    let delivered = false;
    for (const channel of channels) {
      try {
        await sendToChannel(channel, m);
        delivered = true;
      } catch (err) {
        log.warn('notification failed', { channel: channel.name, error: err });
      }
    }
    if (!channels.length) log.info('notification not sent: no channel', { title: m.title });
    return delivered;
  };
}

/** Creates a Gotify channel from GOTIFY_URL/GOTIFY_TOKEN when no channel exists yet. */
export async function seedChannelFromEnv(db: Db, url: string | undefined, token: string | undefined): Promise<void> {
  if (!url || !token) return;
  const existing = await db.select({ id: notificationChannels.id }).from(notificationChannels).limit(1);
  if (existing.length) return;
  await db.insert(notificationChannels).values({ type: 'gotify', name: 'Gotify', url, token });
  log.info('gotify channel created from environment', { url });
}
