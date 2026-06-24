import type { Context } from 'hono';
import * as svc from './superadmin.service.js';
import { ok, noContent, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export async function listAuditLogs(c: Context<AppEnv>) {
  const query = c.req.query();
  const result = await svc.listAuditLogs(query);
  return paginated(c, result.data, result.meta);
}

export async function getDetailedAnalytics(c: Context<AppEnv>) {
  return ok(c, await svc.getDetailedAnalytics());
}

export async function deleteUser(c: Context<AppEnv>) {
  const actor = c.get('user')!;
  await svc.superadminDeleteUser(actor.id, actor.email, c.req.param('userId')!);
  return noContent(c);
}
