import type { ErrorRequestHandler } from 'express';
import type { z } from 'zod';
import { log } from '../log.ts';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function validate<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = details[0]!;
    throw new HttpError(400, first.path ? `${first.path}: ${first.message}` : first.message, details);
  }
  return parsed.data;
}

export function idParam(value: string | string[] | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found');
  return id;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request body is not valid JSON' });
    return;
  }
  log.error('request failed', { method: req.method, path: req.path, error: err });
  res.status(500).json({ error: 'Something went wrong on the server' });
};
