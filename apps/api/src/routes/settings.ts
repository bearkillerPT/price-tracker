import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { SettingsUpdate } from '@price-tracker/shared';
import type { Settings } from '@price-tracker/shared';
import { serverTimeZone } from '../checks/housekeeping.ts';
import type { Db } from '../db/client.ts';
import { settings } from '../db/schema.ts';
import { validate } from '../http/errors.ts';

export function settingsRoutes(db: Db): Router {
  const r = Router();

  const read = async (): Promise<Settings> => {
    const [s] = await db.select().from(settings).where(eq(settings.id, 1));
    return { dailySummaryEnabled: s?.dailySummaryEnabled ?? true, dailySummaryHour: s?.dailySummaryHour ?? 10, timeZone: serverTimeZone() };
  };

  r.get('/settings', async (_req, res) => {
    res.json(await read());
  });

  r.patch('/settings', async (req, res) => {
    const body = validate(SettingsUpdate, req.body);
    await db.update(settings).set({ ...body, updatedAt: new Date() }).where(eq(settings.id, 1));
    res.json(await read());
  });

  return r;
}
