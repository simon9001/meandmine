import type { Context } from 'hono';
import * as svc from './admin.service.js';
import { ok } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export async function getDashboardStats(c: Context<AppEnv>) {
  return ok(c, await svc.getDashboardStats());
}

export async function getDailyRevenue(c: Context<AppEnv>) {
  const days = Number(c.req.query('days') ?? 30);
  return ok(c, await svc.getDailyRevenue(days));
}

export async function getTopProducts(c: Context<AppEnv>) {
  const limit = Number(c.req.query('limit') ?? 10);
  return ok(c, await svc.getTopProducts(limit));
}

export async function refreshMaterializedViews(c: Context<AppEnv>) {
  return ok(c, await svc.refreshMaterializedViews());
}

export async function getLowStockSummary(c: Context<AppEnv>) {
  const threshold = Number(c.req.query('threshold') ?? 5);
  return ok(c, await svc.getLowStockSummary(threshold));
}
