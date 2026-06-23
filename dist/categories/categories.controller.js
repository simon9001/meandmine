import { z } from 'zod';
import * as svc from './categories.service.js';
import { ok, noContent } from '../utils/response.js';
export async function listCategories(c) {
    const activeOnly = c.req.query('all') !== 'true';
    return ok(c, await svc.listCategories(activeOnly));
}
export async function getCategoryBySlug(c) {
    return ok(c, await svc.getCategoryBySlug(c.req.param('slug')));
}
export async function createCategory(c) {
    const body = z.object({
        parentId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
        name: z.string().min(1).max(200),
        slug: z.string().min(1).max(250),
        description: z.string().optional(),
        imageUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
        iconUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
        displayOrder: z.number().int().optional(),
        metaTitle: z.string().max(255).optional(),
        metaDescription: z.string().optional(),
    }).parse(await c.req.json());
    return ok(c, await svc.createCategory(body), 201);
}
export async function updateCategory(c) {
    const body = z.object({
        name: z.string().min(1).max(200).optional(),
        slug: z.string().min(1).max(250).optional(),
        description: z.string().optional(),
        imageUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
        iconUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
        displayOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
        metaTitle: z.string().max(255).optional(),
        metaDescription: z.string().optional(),
    }).parse(await c.req.json());
    return ok(c, await svc.updateCategory(c.req.param('id'), body));
}
export async function deleteCategory(c) {
    await svc.deleteCategory(c.req.param('id'));
    return noContent(c);
}
