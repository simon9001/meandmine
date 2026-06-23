import { z } from 'zod';
import * as svc from './cart.service.js';
import { ok, noContent } from '../utils/response.js';
function getIdentity(c) {
    const user = c.get('user');
    const sessionId = c.req.header('X-Session-Id');
    return { userId: user?.id, sessionId };
}
export async function getCart(c) {
    const { userId, sessionId } = getIdentity(c);
    return ok(c, await svc.getCart(userId, sessionId));
}
export async function addToCart(c) {
    const { userId, sessionId } = getIdentity(c);
    const body = z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid().optional(),
        supplyId: z.string().uuid().optional(),
        quantity: z.number().int().min(1).default(1),
    }).parse(await c.req.json());
    return ok(c, await svc.addToCart({ ...body, userId, sessionId }));
}
export async function updateCartItem(c) {
    const { userId, sessionId } = getIdentity(c);
    const { quantity } = z.object({ quantity: z.number().int().min(1) }).parse(await c.req.json());
    return ok(c, await svc.updateCartItem(c.req.param('itemId'), userId, sessionId, quantity));
}
export async function removeCartItem(c) {
    const { userId, sessionId } = getIdentity(c);
    await svc.removeCartItem(c.req.param('itemId'), userId, sessionId);
    return noContent(c);
}
export async function clearCart(c) {
    const { userId, sessionId } = getIdentity(c);
    await svc.clearCart(userId, sessionId);
    return noContent(c);
}
export async function mergeCart(c) {
    const user = c.get('user');
    const { sessionId } = z.object({ sessionId: z.string() }).parse(await c.req.json());
    await svc.mergeCart(sessionId, user.id);
    return ok(c, { message: 'Cart merged' });
}
