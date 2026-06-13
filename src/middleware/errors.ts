import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../config/logger.js';

export function errorHandler(err: Error, c: Context) {
  const requestId = c.get('requestId') as string | undefined;

  if (err instanceof AppError) {
    logger.warn('App error', { requestId, code: err.code, message: err.message, status: err.statusCode });
    return c.json({ success: false, error: err.message, code: err.code }, err.statusCode as 400);
  }

  if (err instanceof HTTPException) {
    return c.json({ success: false, error: err.message }, err.status);
  }

  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return c.json({ success: false, error: 'Validation failed', issues }, 422);
  }

  logger.error('Unhandled error', { requestId, error: err.message, stack: err.stack });
  return c.json({ success: false, error: 'Internal server error' }, 500);
}
