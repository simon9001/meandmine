import { z } from 'zod';
import * as svc from './notifications.service.js';
import { ok, paginated, noContent } from '../utils/response.js';
export async function listNotifications(c) {
    const user = c.get('user');
    const result = await svc.listNotifications(user.id, c.req.query());
    return paginated(c, result.data, result.meta);
}
export async function markRead(c) {
    const user = c.get('user');
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(await c.req.json());
    await svc.markRead(user.id, ids);
    return noContent(c);
}
export async function markAllRead(c) {
    const user = c.get('user');
    await svc.markAllRead(user.id);
    return noContent(c);
}
export async function getUnreadCount(c) {
    const user = c.get('user');
    return ok(c, await svc.getUnreadCount(user.id));
}
