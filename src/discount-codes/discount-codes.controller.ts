import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './discount-codes.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export async function validateCode(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const { code } = z.object({ code: z.string().min(1) }).parse(await c.req.json());

  // Compute subtotal from the user's actual cart — never trust client-provided amounts
  const { supabaseAdmin } = await import('../config/db.js');
  const { data: cart } = await supabaseAdmin
    .from('carts')
    .select('cart_items(quantity, unit_price)')
    .eq('user_id', user.id)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  type CartItem = { quantity: number; unit_price: number };
  const items = (cart as { cart_items?: CartItem[] } | null)?.cart_items ?? [];
  const subtotal = items.reduce((s: number, i: CartItem) => s + (Number(i.unit_price) * i.quantity), 0);

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
