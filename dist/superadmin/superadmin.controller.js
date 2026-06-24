import * as svc from './superadmin.service.js';
import { ok, noContent, paginated } from '../utils/response.js';
export async function listAuditLogs(c) {
    const query = c.req.query();
    const result = await svc.listAuditLogs(query);
    return paginated(c, result.data, result.meta);
}
export async function getDetailedAnalytics(c) {
    return ok(c, await svc.getDetailedAnalytics());
}
export async function deleteUser(c) {
    const actor = c.get('user');
    await svc.superadminDeleteUser(actor.id, actor.email, c.req.param('userId'));
    return noContent(c);
}
