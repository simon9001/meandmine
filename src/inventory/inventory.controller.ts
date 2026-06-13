import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './inventory.service.js';
import { ok } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export async function listAllInventory(c: Context<AppEnv>) {
  return ok(c, await svc.listAllInventory(c.req.query()));
}

export async function listLowStock(c: Context<AppEnv>) {
  const threshold = Number(c.req.query('threshold')) || 10;
  return ok(c, await svc.listLowStock(threshold));
}

export async function getInventory(c: Context<AppEnv>) {
  const productId = c.req.param('productId')!;
  const variantId = c.req.query('variantId');
  return ok(c, await svc.getInventory(productId, variantId));
}

export async function adjustStock(c: Context<AppEnv>) {
  const { productId, variantId, qty, reason } = z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().nullable().optional(),
    qty:       z.number().int(),
    reason:    z.string().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.adjustStock(productId, variantId ?? null, qty, reason));
}

export async function setStock(c: Context<AppEnv>) {
  const { productId, variantId, totalStock, reorderPoint } = z.object({
    productId:    z.string().uuid(),
    variantId:    z.string().uuid().nullable().optional(),
    totalStock:   z.number().int().min(0),
    reorderPoint: z.number().int().min(0).optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.setStock(productId, variantId ?? null, totalStock, reorderPoint));
}
