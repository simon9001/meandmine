import { z } from 'zod';
import * as svc from './promotions.service.js';
import { ok, noContent } from '../utils/response.js';
const promotionSchema = z.object({
    type: z.enum(['hero_slide', 'navbar_banner']),
    title: z.string().min(1).max(255),
    subtitle: z.string().optional(),
    eyebrow: z.string().optional(),
    imageUrl: z.string().optional(),
    offerText: z.string().optional(),
    offerBg: z.string().optional(),
    ctaText: z.string().optional(),
    ctaUrl: z.string().min(1),
    bgColor: z.string().optional(),
    tags: z.array(z.string()).optional(),
    offerBadgeStyle: z.string().optional(),
    ctaStyle: z.string().optional(),
    displayOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
});
const updateSchema = promotionSchema.partial().omit({ type: true });
export async function listActivePromotions(c) {
    const { type } = c.req.query();
    return ok(c, await svc.listActivePromotions(type));
}
export async function adminListAllPromotions(c) {
    return ok(c, await svc.listAllPromotions());
}
export async function adminCreatePromotion(c) {
    const body = promotionSchema.parse(await c.req.json());
    return ok(c, await svc.createPromotion(body), 201);
}
export async function adminUpdatePromotion(c) {
    const id = c.req.param('id');
    const body = updateSchema.parse(await c.req.json());
    return ok(c, await svc.updatePromotion(id, body));
}
export async function adminDeletePromotion(c) {
    await svc.deletePromotion(c.req.param('id'));
    return noContent(c);
}
