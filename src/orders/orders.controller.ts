import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './orders.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const checkoutItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  supplyId:  z.string().uuid().optional(),
  quantity:  z.number().int().min(1),
});

const checkoutSchema = z.object({
  items:           z.array(checkoutItemSchema).min(1),
  addressId:       z.string().uuid().optional(),
  shippingAddress: z.record(z.string(), z.string()).optional(),
  discountCode:    z.string().optional(),
  shippingFee:     z.number().min(0).optional(),
  notes:           z.string().max(500).optional(),
  idempotencyKey:  z.string().optional(),
});

export async function listMyOrders(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const result = await svc.listOrders(user.id, c.req.query());
  return paginated(c, result.data, result.meta);
}

export async function getMyOrder(c: Context<AppEnv>) {
  const user = c.get('user')!;
  return ok(c, await svc.getOrder(c.req.param('orderId')!, user.id));
}

export async function createOrder(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const body = checkoutSchema.parse(await c.req.json());
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return ok(c, await svc.createOrder(user.id, body, ip), 201);
}

export async function cancelOrder(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const { reason } = z.object({ reason: z.string().optional() }).parse(await c.req.json());
  return ok(c, await svc.cancelOrder(user.id, c.req.param('orderId')!, reason));
}

// ─── Admin ─────────────────────────────────────────────────────────────────────

export async function adminListOrders(c: Context<AppEnv>) {
  const result = await svc.adminListOrders(c.req.query());
  return paginated(c, result.data, result.meta);
}

export async function adminGetOrder(c: Context<AppEnv>) {
  return ok(c, await svc.getOrder(c.req.param('orderId')!));
}

export async function updateOrderStatus(c: Context<AppEnv>) {
  const { status, adminNote } = z.object({
    status:    z.enum(['pending', 'confirmed', 'processing', 'dispatched', 'out_for_delivery', 'shipped', 'delivered', 'cancelled', 'refunded']),
    adminNote: z.string().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.updateOrderStatus(c.req.param('orderId')!, status, adminNote));
}

// ─── Guest checkout & public tracking ────────────────────────────────────────

const guestCheckoutSchema = z.object({
  items: z.array(z.object({
    name:     z.string().min(1),
    price:    z.number().min(0),
    quantity: z.number().int().min(1),
  })).min(1),
  customerName: z.string().min(2),
  phone:        z.string().min(9).max(13),
  email:        z.string().email().optional().or(z.literal('')),
  address:      z.string().min(5),
  zone:         z.enum(['nairobi', 'upcountry']),
  payment:      z.enum(['mpesa', 'cod']),
  shippingFee:  z.number().min(0),
});

export async function createGuestOrder(c: Context<AppEnv>) {
  const body = guestCheckoutSchema.parse(await c.req.json());
  return ok(c, await svc.createGuestOrder(body), 201);
}

export async function trackOrder(c: Context<AppEnv>) {
  return ok(c, await svc.trackOrderByNumber(c.req.param('orderNumber')!));
}
