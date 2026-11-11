import { Router } from 'express';
import { countryFromHost } from '../catalog.ts';
import { LiveSessionCreate } from '@price-tracker/shared';
import type { LiveSession as LiveSessionDto } from '@price-tracker/shared';
import type { LiveSessions } from '../browser/live.ts';
import { liveUrl } from '../browser/live.ts';
import { HttpError, validate } from '../http/errors.ts';
import { localeFor } from '../stores/generic/adapter.ts';

export function browserRoutes(sessions: LiveSessions): Router {
  const r = Router();

  // Opens a page in Chromium on the server; the UI then connects to /api/browser/live?id=...
  r.post('/browser/sessions', async (req, res) => {
    const { url: raw } = validate(LiveSessionCreate, req.body);
    const url = liveUrl(raw);
    if (!url) throw new HttpError(422, "That isn't a public web address");
    try {
      const session = await sessions.open(url, localeFor(countryFromHost(new URL(url).hostname)));
      res.status(201).json({ id: session.id } satisfies LiveSessionDto);
    } catch (err) {
      throw new HttpError(503, err instanceof Error ? err.message : String(err));
    }
  });

  r.delete('/browser/sessions/:id', async (req, res) => {
    await sessions.get(String(req.params.id))?.close('Closed');
    res.json({ ok: true });
  });

  return r;
}
