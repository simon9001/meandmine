import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './suppliers.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export async function listSuppliers(c: Context<AppEnv>) {
  const result = await svc.listSuppliers(c.req.query());
  return paginated(c, result.data, result.meta);
}

export async function getSupplierById(c: Context<AppEnv>) {
  return ok(c, await svc.getSupplierById(c.req.param('id')!));
}

export async function createSupplier(c: Context<AppEnv>) {
  const body = z.object({
    name:          z.string().min(1).max(255),
    slug:          z.string().min(1).max(300),
    email:         z.string().email().optional(),
    phone:         z.string().max(30).optional(),
    websiteUrl:    z.string().url().optional(),
    countryCode:   z.string().length(2).optional(),
    city:          z.string().max(100).optional(),
    address:       z.string().optional(),
    contactPerson: z.string().max(200).optional(),
    notes:         z.string().optional(),
    metadata:      z.record(z.string(), z.unknown()).optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.createSupplier(body), 201);
}

export async function updateSupplier(c: Context<AppEnv>) {
  const body = z.object({
    name:          z.string().min(1).max(255).optional(),
    email:         z.string().email().optional(),
    phone:         z.string().max(30).optional(),
    websiteUrl:    z.string().url().optional(),
    countryCode:   z.string().length(2).optional(),
    city:          z.string().max(100).optional(),
    address:       z.string().optional(),
    contactPerson: z.string().max(200).optional(),
    rating:        z.number().min(0).max(5).optional(),
    isVerified:    z.boolean().optional(),
    isActive:      z.boolean().optional(),
    notes:         z.string().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.updateSupplier(c.req.param('id')!, body));
}

export async function listProductSupply(c: Context<AppEnv>) {
  return ok(c, await svc.listProductSupply(c.req.param('productId')!));
}

export async function upsertProductSupply(c: Context<AppEnv>) {
  const body = z.object({
    productId:      z.string().uuid(),
    supplierId:     z.string().uuid(),
    variantId:      z.string().uuid().optional(),
    supplierSku:    z.string().max(200).optional(),
    supplierPrice:  z.number().min(0),
    currency:       z.enum(['KES', 'NGN', 'USD', 'GBP']).optional(),
    minOrderQty:    z.number().int().min(1).optional(),
    leadTimeDays:   z.number().int().optional(),
    stockQuantity:  z.number().int().min(0).optional(),
    status:         z.enum(['active', 'discontinued', 'out_of_stock', 'on_hold']).optional(),
    isPreferred:    z.boolean().optional(),
    notes:          z.string().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.upsertProductSupply(body));
}

export async function getPricingHistory(c: Context<AppEnv>) {
  const productId = c.req.param('productId')!;
  const supplierId = c.req.query('supplierId');
  return ok(c, await svc.getPricingHistory(productId, supplierId));
}
