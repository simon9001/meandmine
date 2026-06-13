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

export async function handleWebhook(c: Context<AppEnv>) {
  const rawBody  = await c.req.text();
  const sig      = c.req.header('x-paystack-signature') ?? '';
  return ok(c, await svc.handleWebhook(rawBody, sig));
}
