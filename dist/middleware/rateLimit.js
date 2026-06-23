import { createMiddleware } from 'hono/factory';
import { env } from '../config/env.js';
const store = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, rec] of store) {
        if (rec.resetAt <= now)
            store.delete(key);
    }
}, 5 * 60 * 1000);
export function authRateLimit() { return rateLimit(5, 60_000); }
export function sensitiveRateLimit() { return rateLimit(3, 15 * 60_000); }
export function rateLimit(max = env.RATE_LIMIT_MAX, windowMs = env.RATE_LIMIT_WINDOW_MS) {
    return createMiddleware(async (c, next) => {
        const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
            c.req.header('x-real-ip') ??
            'unknown';
        const now = Date.now();
        const key = `${ip}:${c.req.path}`;
        let rec = store.get(key);
        if (!rec || rec.resetAt <= now) {
            rec = { count: 1, resetAt: now + windowMs };
            store.set(key, rec);
        }
        else {
            rec.count++;
        }
        c.header('X-RateLimit-Limit', String(max));
        c.header('X-RateLimit-Remaining', String(Math.max(0, max - rec.count)));
        c.header('X-RateLimit-Reset', String(Math.ceil(rec.resetAt / 1000)));
        if (rec.count > max) {
            return c.json({ success: false, error: 'Too many requests' }, 429);
        }
        await next();
    });
}
