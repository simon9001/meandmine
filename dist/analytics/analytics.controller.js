import { z } from 'zod';
import { trackEvent } from './analytics.service.js';
import { ok } from '../utils/response.js';
const eventSchema = z.object({
    eventType: z.enum(['page_view', 'product_view', 'add_to_cart', 'remove_from_cart', 'begin_checkout', 'purchase', 'search']),
    productId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    searchQuery: z.string().optional(),
    sessionId: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
});
export async function track(c) {
    const user = c.get('user');
    const body = eventSchema.parse(await c.req.json());
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    const ua = c.req.header('user-agent');
    const sessId = body.sessionId ?? c.req.header('X-Session-Id');
    await trackEvent({ ...body, userId: user?.id, sessionId: sessId, ip, userAgent: ua });
    return ok(c, { tracked: true });
}
