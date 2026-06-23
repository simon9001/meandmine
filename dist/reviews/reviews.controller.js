import { z } from 'zod';
import * as svc from './reviews.service.js';
import { ok, paginated } from '../utils/response.js';
export async function listProductReviews(c) {
    const productId = c.req.param('productId');
    const result = await svc.listProductReviews(productId, c.req.query());
    return paginated(c, result.data, result.meta);
}
export async function createReview(c) {
    const user = c.get('user');
    const body = z.object({
        productId: z.string().uuid(),
        orderId: z.string().uuid().optional(),
        rating: z.number().int().min(1).max(5),
        title: z.string().max(200).optional(),
        body: z.string().min(10).max(2000),
    }).parse(await c.req.json());
    return ok(c, await svc.createReview(user.id, body), 201);
}
export async function voteReview(c) {
    const user = c.get('user');
    const { vote } = z.object({ vote: z.enum(['helpful', 'not_helpful']) }).parse(await c.req.json());
    return ok(c, await svc.voteReview(user.id, c.req.param('reviewId'), vote));
}
export async function adminListReviews(c) {
    const result = await svc.adminListReviews(c.req.query());
    return paginated(c, result.data, result.meta);
}
export async function moderateReview(c) {
    const { status } = z.object({
        status: z.enum(['approved', 'rejected']),
    }).parse(await c.req.json());
    return ok(c, await svc.moderateReview(c.req.param('reviewId'), status));
}
