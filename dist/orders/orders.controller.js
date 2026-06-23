import { z } from 'zod';
import * as svc from './orders.service.js';
import { ok, paginated } from '../utils/response.js';
const checkoutItemSchema = z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    supplyId: z.string().uuid().optional(),
    quantity: z.number().int().min(1),
});
const deliveryInfoSchema = z.object({
    recipientName: z.string().min(1, 'Recipient name is required'),
    phone: z.string().min(9).max(15),
    county: z.string().min(1, 'County is required'),
    town: z.string().min(1, 'Town is required'),
    stage: z.string().optional(),
    deliveryMethod: z.enum(['home_delivery', 'pickup']),
    preferredProvider: z.string().optional(),
    instructions: z.string().max(500).optional(),
});
const checkoutSchema = z.object({
    items: z.array(checkoutItemSchema).min(1),
    deliveryInfo: deliveryInfoSchema,
    discountCode: z.string().optional(),
    notes: z.string().max(500).optional(),
    idempotencyKey: z.string().optional(),
});
const dispatchSchema = z.object({
    parcelRef: z.string().optional(),
    trackingNo: z.string().optional(),
    collectionPoint: z.string().optional(),
    dispatchNotes: z.string().max(1000).optional(),
});
export async function listMyOrders(c) {
    const user = c.get('user');
    const result = await svc.listOrders(user.id, c.req.query());
    return paginated(c, result.data, result.meta);
}
export async function getMyOrder(c) {
    const user = c.get('user');
    return ok(c, await svc.getOrder(c.req.param('orderId'), user.id));
}
export async function createOrder(c) {
    const user = c.get('user');
    const body = checkoutSchema.parse(await c.req.json());
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    return ok(c, await svc.createOrder(user.id, body, ip), 201);
}
export async function cancelOrder(c) {
    const user = c.get('user');
    const { reason } = z.object({ reason: z.string().optional() }).parse(await c.req.json());
    return ok(c, await svc.cancelOrder(user.id, c.req.param('orderId'), reason));
}
// ─── Admin ─────────────────────────────────────────────────────────────────────
export async function adminListOrders(c) {
    const result = await svc.adminListOrders(c.req.query());
    return paginated(c, result.data, result.meta);
}
export async function adminGetOrder(c) {
    return ok(c, await svc.getOrder(c.req.param('orderId')));
}
export async function updateOrderStatus(c) {
    const { status, adminNote } = z.object({
        status: z.enum(['pending_payment', 'paid', 'awaiting_dispatch', 'dispatched', 'delivered', 'cancelled']),
        adminNote: z.string().optional(),
    }).parse(await c.req.json());
    return ok(c, await svc.updateOrderStatus(c.req.param('orderId'), status, adminNote));
}
export async function dispatchOrder(c) {
    const body = dispatchSchema.parse(await c.req.json());
    return ok(c, await svc.dispatchOrder(c.req.param('orderId'), body));
}
// ─── Guest checkout & public tracking ────────────────────────────────────────
const guestCheckoutSchema = z.object({
    items: z.array(z.object({
        productId: z.string().uuid().optional(),
        name: z.string().min(1),
        price: z.number().min(1), // min 1 prevents zero-price abuse for bespoke items
        quantity: z.number().int().min(1).max(100),
    })).min(1).max(50),
    customerName: z.string().min(2).max(100),
    phone: z.string().min(9).max(15),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().min(5).max(500),
    zone: z.enum(['nairobi', 'upcountry']),
    payment: z.enum(['mpesa', 'cod']),
    shippingFee: z.number().min(0).max(10000),
});
export async function createGuestOrder(c) {
    const body = guestCheckoutSchema.parse(await c.req.json());
    return ok(c, await svc.createGuestOrder(body), 201);
}
export async function trackOrder(c) {
    return ok(c, await svc.trackOrderByNumber(c.req.param('orderNumber')));
}
