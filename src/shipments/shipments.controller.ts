import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './shipments.service.js';
import { ok } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export async function getShipmentForOrder(c: Context<AppEnv>) {
  return ok(c, await svc.getShipmentForOrder(c.req.param('orderId')!));
}

export async function createShipment(c: Context<AppEnv>) {
  const body = z.object({
    orderId:          z.string().uuid(),
    carrier:          z.string().optional(),
    trackingNumber:   z.string().optional(),
    trackingUrl:      z.string().url().optional(),
    estimatedDelivery: z.string().datetime().optional(),
    notes:            z.string().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.createShipment(body), 201);
}

export async function addTrackingEvent(c: Context<AppEnv>) {
  const body = z.object({
    status:      z.string(),
    location:    z.string().optional(),
    description: z.string().optional(),
    occurredAt:  z.string().datetime().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.addTrackingEvent(c.req.param('shipmentId')!, body));
}
