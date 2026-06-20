import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './upload.service.js';
import * as usersSvc from '../users/users.service.js';
import { ok } from '../utils/response.js';
import { BadRequestError } from '../utils/errors.js';
import type { AppEnv } from '../types/index.js';

export async function uploadProductImage(c: Context<AppEnv>) {
  const productId = z.string().uuid().parse(c.req.param('productId'));
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) throw new BadRequestError('file field is required');
  return ok(c, await svc.uploadProductImage(file, productId));
}

export async function uploadProductMediaImage(c: Context<AppEnv>) {
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) throw new BadRequestError('file field is required');
  return ok(c, await svc.uploadProductMediaImage(file));
}

export async function uploadReviewImage(c: Context<AppEnv>) {
  const reviewId = z.string().uuid().parse(c.req.param('reviewId'));
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) throw new BadRequestError('file field is required');
  return ok(c, await svc.uploadReviewImage(file, reviewId));
}

export async function uploadCategoryImage(c: Context<AppEnv>) {
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) throw new BadRequestError('file field is required');
  return ok(c, await svc.uploadCategoryImage(file));
}

export async function uploadAvatarImage(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) throw new BadRequestError('file field is required');
  const result = await svc.uploadAvatarImage(file, user.id);
  await usersSvc.updateAvatar(user.id, result.url);
  return ok(c, { avatarUrl: result.url });
}

export async function uploadPromotionImage(c: Context<AppEnv>) {
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) throw new BadRequestError('file field is required');
  return ok(c, await svc.uploadPromotionImage(file));
}

export async function deleteUploadedImage(c: Context<AppEnv>) {
  const { publicId } = z.object({ publicId: z.string().min(1) }).parse(await c.req.json());
  await svc.deleteImage(publicId);
  return ok(c, { deleted: true });
}
