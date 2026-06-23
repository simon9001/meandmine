import { z } from 'zod';
import * as svc from './wishlist.service.js';
import { ok, noContent } from '../utils/response.js';
export async function listWishlist(c) {
    const user = c.get('user');
    return ok(c, await svc.listWishlist(user.id));
}
export async function addToWishlist(c) {
    const user = c.get('user');
    const { productId, variantId } = z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().optional(),
    }).parse(await c.req.json());
    return ok(c, await svc.addToWishlist(user.id, productId, variantId));
}
export async function removeFromWishlist(c) {
    const user = c.get('user');
    await svc.removeFromWishlist(user.id, c.req.param('id'));
    return noContent(c);
}
export async function checkInWishlist(c) {
    const user = c.get('user');
    return ok(c, await svc.checkInWishlist(user.id, c.req.param('productId')));
}
