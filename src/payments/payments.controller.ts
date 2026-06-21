import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './payments.service.js';
import { ok } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export async function initializePayment(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const { orderId } = z.object({ orderId: z.string().uuid() }).parse(await c.req.json());
  return ok(c, await svc.initializePayment(user.id, orderId));
}

export async function verifyPayment(c: Context<AppEnv>) {
  const user = c.get('user')!;
  return ok(c, await svc.verifyPayment(c.req.param('reference')!, user.id));
}

export async function getPaymentForOrder(c: Context<AppEnv>) {
  const user = c.get('user')!;
  return ok(c, await svc.getPaymentForOrder(c.req.param('orderId')!, user.id));
}

export async function chargeMpesa(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const { orderId, phone } = z.object({
    orderId: z.string().uuid(),
    phone:   z.string().regex(/^(?:254|\+254|0)?(7|1)\d{8}$/, 'Invalid phone number format'),
  }).parse(await c.req.json());
  return ok(c, await svc.chargeMpesa(user.id, orderId, phone));
}

export async function checkPaymentStatus(c: Context<AppEnv>) {
  const user = c.get('user')!;
  return ok(c, await svc.checkPaymentStatus(c.req.param('reference')!, user.id));
}

export async function handleWebhook(c: Context<AppEnv>) {
  const rawBody  = await c.req.text();
  const sig      = c.req.header('x-paystack-signature') ?? '';
  return ok(c, await svc.handleWebhook(rawBody, sig));
}
