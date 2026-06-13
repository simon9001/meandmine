import type { Context } from 'hono';
import { z } from 'zod';
import * as usersService from './users.service.js';
import { ok, noContent, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export async function getProfile(c: Context<AppEnv>) {
  const user = c.get('user')!;
  return ok(c, await usersService.getProfile(user.id));
}

export async function updateProfile(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const body = z.object({
    firstName:         z.string().min(1).max(100).optional(),
    lastName:          z.string().min(1).max(100).optional(),
    phone:             z.string().max(30).optional(),
    preferredCurrency: z.enum(['KES', 'NGN', 'USD', 'GBP']).optional(),
    preferredLanguage: z.string().max(10).optional(),
    notificationPrefs: z.record(z.string(), z.boolean()).optional(),
  }).parse(await c.req.json());
  return ok(c, await usersService.updateProfile(user.id, body));
}

export async function listAddresses(c: Context<AppEnv>) {
  const user = c.get('user')!;
  return ok(c, await usersService.listAddresses(user.id));
}

export async function createAddress(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const body = z.object({
    label:         z.string().max(50).optional(),
    recipientName: z.string().min(1).max(255),
    phone:         z.string().min(1).max(30),
    addressLine1:  z.string().min(1).max(300),
    addressLine2:  z.string().max(300).optional(),
    city:          z.string().min(1).max(100),
    county:        z.string().max(100).optional(),
    postalCode:    z.string().max(20).optional(),
    countryCode:   z.string().length(2).optional(),
    isDefault:     z.boolean().optional(),
  }).parse(await c.req.json());
  return ok(c, await usersService.createAddress(user.id, body), 201);
}

export async function updateAddress(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const addressId = c.req.param('addressId')!;
  const body = z.object({
    label:         z.string().max(50).optional(),
    recipientName: z.string().min(1).max(255).optional(),
    phone:         z.string().max(30).optional(),
    addressLine1:  z.string().min(1).max(300).optional(),
    addressLine2:  z.string().max(300).optional(),
    city:          z.string().min(1).max(100).optional(),
    county:        z.string().max(100).optional(),
    postalCode:    z.string().max(20).optional(),
    isDefault:     z.boolean().optional(),
  }).parse(await c.req.json());
  return ok(c, await usersService.updateAddress(user.id, addressId, body));
}

export async function deleteAddress(c: Context<AppEnv>) {
  const user = c.get('user')!;
  await usersService.deleteAddress(user.id, c.req.param('addressId')!);
  return noContent(c);
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function listUsers(c: Context<AppEnv>) {
  const query = c.req.query();
  const result = await usersService.listUsers(query);
  return paginated(c, result.data, result.meta);
}

export async function setUserRole(c: Context<AppEnv>) {
  const actor = c.get('user')!;
  const { role } = z.object({ role: z.enum(['customer', 'admin', 'superadmin', 'supplier_rep']) })
    .parse(await c.req.json());
  return ok(c, await usersService.setUserRole(actor.id, c.req.param('userId')!, role));
}
