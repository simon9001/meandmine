import { createMiddleware } from 'hono/factory';
import { randomUUID } from 'crypto';
import { logger } from '../config/logger.js';
const REDACTED = new Set(['password', 'token', 'secret', 'card', 'cvv', 'pin', 'otp']);
function redact(obj, depth = 0) {
    if (depth > 4 || obj === null || typeof obj !== 'object')
        return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = REDACTED.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
}
export const requestLogger = createMiddleware(async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    const start = Date.now();
    const { method, path } = c.req;
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    let body;
    try {
        const ct = c.req.header('content-type') ?? '';
        if (ct.includes('application/json') && method !== 'GET') {
            body = redact(await c.req.raw.clone().json());
        }
    }
    catch { /* ignore */ }
    logger.info('→ request', { requestId, method, path, ip, body });
    await next();
    logger.info('← response', {
        requestId, method, path,
        status: c.res.status,
        durationMs: Date.now() - start,
    });
});
