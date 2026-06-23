import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';
let client = null;
export function getRedis() {
    return client;
}
export function connectRedis() {
    if (!env.REDIS_URL) {
        logger.warn('[redis] REDIS_URL not set — caching disabled, app works normally without it');
        return;
    }
    client = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3_000,
        commandTimeout: 2_000,
        lazyConnect: false,
    });
    client.on('connect', () => logger.info('[redis] Connected'));
    client.on('ready', () => logger.info('[redis] Ready'));
    client.on('error', (err) => {
        logger.warn('[redis] Error — cache bypassed for this request', { message: err.message });
    });
    client.on('close', () => logger.warn('[redis] Connection closed'));
}
export async function disconnectRedis() {
    if (client) {
        await client.quit();
        client = null;
    }
}
