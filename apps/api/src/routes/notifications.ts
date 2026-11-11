import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { NotificationChannelCreate, NotificationChannelUpdate } from '@price-tracker/shared';
import type { NotificationChannel } from '@price-tracker/shared';
import type { Db } from '../db/client.ts';
import { notificationChannels } from '../db/schema.ts';
import { HttpError, idParam, validate } from '../http/errors.ts';
import { sendToChannel } from '../notify/index.ts';

export function notificationRoutes(db: Db): Router {
  const r = Router();

  // The token is never sent back to the browser
  const list = async (): Promise<NotificationChannel[]> =>
    (await db.select().from(notificationChannels).orderBy(notificationChannels.id)).map((c) => ({
      id: c.id,
      type: 'gotify',
      name: c.name,
      url: c.url,
      tokenSet: c.token.length > 0,
      enabled: c.enabled,
    }));

  r.get('/notification-channels', async (_req, res) => {
    res.json(await list());
  });

  r.post('/notification-channels', async (req, res) => {
    const body = validate(NotificationChannelCreate, req.body);
    await db.insert(notificationChannels).values(body);
    res.status(201).json(await list());
  });

  r.patch('/notification-channels/:id', async (req, res) => {
    const body = validate(NotificationChannelUpdate, req.body);
    const updated = await db.update(notificationChannels).set(body).where(eq(notificationChannels.id, idParam(req.params.id))).returning({ id: notificationChannels.id });
    if (!updated.length) throw new HttpError(404, 'Channel not found');
    res.json(await list());
  });

  r.delete('/notification-channels/:id', async (req, res) => {
    const deleted = await db.delete(notificationChannels).where(eq(notificationChannels.id, idParam(req.params.id))).returning({ id: notificationChannels.id });
    if (!deleted.length) throw new HttpError(404, 'Channel not found');
    res.json(await list());
  });

  r.post('/notification-channels/:id/test', async (req, res) => {
    const [channel] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, idParam(req.params.id)));
    if (!channel) throw new HttpError(404, 'Channel not found');
    try {
      await sendToChannel(channel, { title: 'Price tracker', message: 'Test notification: this channel works.', priority: 5 });
    } catch (err) {
      throw new HttpError(502, `Sending failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    res.json({ ok: true });
  });

  return r;
}
