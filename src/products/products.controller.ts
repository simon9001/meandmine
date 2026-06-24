import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './products.service.js';
import { ok, noContent, paginated } from '../utils/response.js';
import { productViewsTotal } from '../config/metrics.js';
import type { AppEnv } from '../types/index.js';

export async function listProducts(c: Context<AppEnv>) {
  const query = c.req.query();
  const result = await svc.listProducts(query);
  return paginated(c, result.data, result.meta);
}

export async function getProductBySlug(c: Context<AppEnv>) {
  const product = await svc.getProductBySlug(c.req.param('slug')!);
  svc.incrementViewCount(product.id as string).catch(() => {});
  productViewsTotal.inc();
  return ok(c, product);
}

export async function getSupplierComparison(c: Context<AppEnv>) {
  return ok(c, await svc.getSupplierComparison(c.req.param('productId')!));
}

export async function createProduct(c: Context<AppEnv>) {
  const body = z.object({
    categoryId:             z.string().uuid().optional(),
    brandId:                z.string().uuid().optional(),
    name:                   z.string().min(1).max(500),
    slug:                   z.string().min(1).max(600),
    sku:                    z.string().max(100).optional(),
    shortDescription:       z.string().optional(),
    fullDescription:        z.string().optional(),
    basePrice:              z.number().min(0),
    salePrice:              z.number().min(0).optional(),
    costPrice:              z.number().min(0).optional(),
    currency:               z.enum(['KES', 'NGN', 'USD', 'GBP']).optional(),
    status:                 z.enum(['draft', 'active', 'archived', 'out_of_stock']).optional(),
    isFeatured:             z.boolean().optional(),
    isNewArrival:           z.boolean().optional(),
    showSalePrice:          z.boolean().optional(),
    metaTitle:              z.string().max(255).optional(),
    metaDescription:        z.string().optional(),
    metaKeywords:           z.array(z.string()).optional(),
    stockWarningThreshold:  z.number().int().optional(),
    weightGrams:            z.number().int().optional(),
    attributes:             z.record(z.string(), z.unknown()).optional(),
    tags:                   z.array(z.string()).optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.createProduct(body), 201);
}

export async function updateProduct(c: Context<AppEnv>) {
  const body = z.object({
    categoryId:             z.string().uuid().optional(),
    brandId:                z.string().uuid().optional(),
    name:                   z.string().min(1).max(500).optional(),
    slug:                   z.string().min(1).max(600).optional(),
    sku:                    z.string().max(100).optional(),
    shortDescription:       z.string().optional(),
    fullDescription:        z.string().optional(),
    basePrice:              z.number().min(0).optional(),
    salePrice:              z.number().min(0).nullable().optional(),
    costPrice:              z.number().min(0).optional(),
    status:                 z.enum(['draft', 'active', 'archived', 'out_of_stock']).optional(),
    isFeatured:             z.boolean().optional(),
    isNewArrival:           z.boolean().optional(),
    isBestSeller:           z.boolean().optional(),
    showSalePrice:          z.boolean().optional(),
    metaTitle:              z.string().max(255).optional(),
    metaDescription:        z.string().optional(),
    metaKeywords:           z.array(z.string()).optional(),
    stockWarningThreshold:  z.number().int().optional(),
    weightGrams:            z.number().int().optional(),
    attributes:             z.record(z.string(), z.unknown()).optional(),
    tags:                   z.array(z.string()).optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.updateProduct(c.req.param('id')!, body));
}

export async function deleteProduct(c: Context<AppEnv>) {
  await svc.deleteProduct(c.req.param('id')!);
  return noContent(c);
}

export async function addProductMedia(c: Context<AppEnv>) {
  const body = z.object({
    mediaType:    z.enum(['image', 'video', '360_view']).optional(),
    url:          z.string().url(),
    thumbnailUrl: z.string().url().optional(),
    altText:      z.string().max(500).optional(),
    displayOrder: z.number().int().optional(),
    isPrimary:    z.boolean().optional(),
    variantId:    z.string().uuid().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.addProductMedia(c.req.param('productId')!, body), 201);
}

export async function deleteProductMedia(c: Context<AppEnv>) {
  await svc.deleteProductMedia(c.req.param('productId')!, c.req.param('mediaId')!);
  return noContent(c);
}

export async function createProductVariant(c: Context<AppEnv>) {
  const body = z.object({
    name:            z.string().min(1),
    sku:             z.string().optional(),
    options:         z.record(z.string(), z.string()),
    additionalPrice: z.number().optional(),
    stockQuantity:   z.number().int().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.createProductVariant(c.req.param('productId')!, body), 201);
}

export async function updateProductVariant(c: Context<AppEnv>) {
  const body = z.object({
    name:            z.string().min(1).optional(),
    sku:             z.string().nullable().optional(),
    options:         z.record(z.string(), z.string()).optional(),
    additionalPrice: z.number().min(0).optional(),
    stockQuantity:   z.number().int().min(0).optional(),
    isActive:        z.boolean().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.updateProductVariant(c.req.param('productId')!, c.req.param('variantId')!, body));
}

export async function deleteProductVariant(c: Context<AppEnv>) {
  await svc.deleteProductVariant(c.req.param('productId')!, c.req.param('variantId')!);
  return noContent(c);
}
