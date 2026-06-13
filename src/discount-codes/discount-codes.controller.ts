import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './discount-codes.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export async function validateCode(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const { code, subtotal } = z.object({
    code:     z.string().min(1),
    subtotal: z.number().min(0),
  }).parse(await c.req.json());
  return ok(c, await svc.validateDiscountCode(code, user.id, subtotal));
}

export async function listCodes(c: Context<AppEnv>) {
  const result = await svc.listDiscountCodes(c.req.query());
  return paginated(c, result.data, result.meta);
}

export async function createCode(c: Context<AppEnv>) {
  const body = z.object({
    code:               z.string().min(3).max(50),
    name:               z.string().max(200).optional(),
    description:        z.string().optional(),
    discountType:       z.enum(['percentage', 'fixed_amount', 'free_shipping']),
    discountValue:      z.number().positive(),
    minOrderValue:      z.number().min(0).optional(),
    maxDiscountAmount:  z.number().positive().optional(),
    maxUses:            z.number().int().positive().optional(),
    usesPerUser:        z.number().int().positive().optional(),
    isActive:           z.boolean().optional(),
    validFrom:          z.string().datetime().optional(),
    validUntil:         z.string().datetime().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.createDiscountCode(body), 201);
}

export async function updateCode(c: Context<AppEnv>) {
  const body = z.object({
    name:               z.string().max(200).optional(),
    description:        z.string().optional(),
    discountValue:      z.number().positive().optional(),
    minOrderValue:      z.number().min(0).optional(),
    maxDiscountAmount:  z.number().positive().optional(),
    maxUses:            z.number().int().positive().optional(),
    isActive:           z.boolean().optional(),
    validFrom:          z.string().datetime().optional(),
    validUntil:         z.string().datetime().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.updateDiscountCode(c.req.param('id')!, body));
}
