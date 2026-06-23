import { createHash } from 'crypto';
import { getRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';
const NS = 'maschon'; // namespace prefix for all keys
export function buildKey(prefix, ...parts) {
    if (parts.length === 0)
        return `${NS}:${prefix}`;
    const payload = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(':');
    // Hash only if the payload would be long / contain special chars
    if (payload.length > 60 || payload.includes('{')) {
        const hash = createHash('md5').update(payload).digest('hex').slice(0, 12);
        return `${NS}:${prefix}:${hash}`;
    }
    return `${NS}:${prefix}:${payload}`;
}
export async function cacheGet(key) {
    const redis = getRedis();
    if (!redis)
        return null;
    try {
        const raw = await redis.get(key);
        return raw ? JSON.parse(raw) : null;
    }
    catch (err) {
        logger.warn('[cache] get failed', { key, err });
        return null;
    }
}
export async function cacheSet(key, value, ttlSeconds) {
    const redis = getRedis();
    if (!redis)
        return;
    try {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    }
    catch (err) {
        logger.warn('[cache] set failed', { key, err });
    }
}
export async function cacheDel(...keys) {
    const redis = getRedis();
    if (!redis || keys.length === 0)
        return;
    try {
        await redis.del(...keys);
    }
    catch (err) {
        logger.warn('[cache] del failed', { keys, err });
    }
}
// Safe pattern delete using SCAN (non-blocking, unlike KEYS)
export async function cacheDelPattern(pattern) {
    const redis = getRedis();
    if (!redis)
        return;
    try {
        const stream = redis.scanStream({ match: pattern, count: 200 });
        const toDelete = [];
        for await (const batch of stream) {
            toDelete.push(...batch);
        }
        if (toDelete.length > 0)
            await redis.del(...toDelete);
    }
    catch (err) {
        logger.warn('[cache] delPattern failed', { pattern, err });
    }
}
