import { supabaseAdmin } from '../config/db.js';
import { sendEmail, templates } from '../config/email.js';
import { ordersCreatedTotal } from '../config/metrics.js';
import { NotFoundError, BadRequestError, UnprocessableError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
export async function listOrders(userId, query) {
    const { page, limit, offset } = parsePage(query);
    let q = supabaseAdmin
        .from('orders')
        .select('id, order_number, status, payment_status, total_amount, currency, placed_at, delivered_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('placed_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (query.status)
        q = q.eq('status', query.status);
    const { data, count } = await q;
    return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
export async function getOrder(orderId, userId) {
    let q = supabaseAdmin
        .from('orders')
        .select(`
      *,
      order_items(id, product_id, variant_id, supply_id, supplier_id, product_name, product_sku, variant_options, quantity, unit_price, total_price, fulfillment_status),
      order_status_history(from_status, to_status, reason, changed_at)
    `)
        .eq('id', orderId);
    if (userId)
        q = q.eq('user_id', userId);
    const { data, error } = await q.single();
    if (error || !data)
        throw new NotFoundError('Order');
    return data;
}
export async function createOrder(userId, payload, _ip) {
    // Idempotency check
    if (payload.idempotencyKey) {
        const { data: existing } = await supabaseAdmin
            .from('orders')
            .select('id, order_number')
            .eq('metadata->idempotency_key', payload.idempotencyKey)
            .maybeSingle();
        if (existing)
            return existing;
    }
    // Validate items and compute subtotal
    let subtotal = 0;
    const lineItems = [];
    for (const item of payload.items) {
        const { data: product, error } = await supabaseAdmin
            .from('products')
            .select('id, name, sku, base_price, sale_price, cost_price, status')
            .eq('id', item.productId)
            .eq('status', 'active')
            .single();
        if (error || !product)
            throw new UnprocessableError(`Product ${item.productId} not available`);
        const p = product;
        let unitPrice = (p.sale_price && p.sale_price > 0) ? Number(p.sale_price) : Number(p.base_price);
        let variantOptions;
        if (item.variantId) {
            const { data: variant } = await supabaseAdmin
                .from('product_variants')
                .select('additional_price, options, is_active')
                .eq('id', item.variantId)
                .single();
            if (!variant || !variant.is_active)
                throw new UnprocessableError(`Variant not available`);
            unitPrice += Number(variant.additional_price ?? 0);
            variantOptions = variant.options;
        }
        // Check inventory
        const { data: inv } = await supabaseAdmin
            .from('inventory')
            .select('available_stock')
            .eq('product_id', item.productId)
            .is('variant_id', item.variantId ?? null)
            .maybeSingle();
        if (inv && inv.available_stock < item.quantity) {
            throw new UnprocessableError(`Insufficient stock for ${product.name}`);
        }
        // Resolve supplier from supply
        let supplierId;
        let unitCost = Number(product.cost_price ?? 0);
        if (item.supplyId) {
            const { data: supply } = await supabaseAdmin
                .from('product_supply')
                .select('supplier_id, supplier_price')
                .eq('id', item.supplyId)
                .single();
            if (supply) {
                supplierId = supply.supplier_id;
                unitCost = Number(supply.supplier_price);
            }
        }
        subtotal += unitPrice * item.quantity;
        lineItems.push({
            productId: item.productId,
            variantId: item.variantId,
            supplyId: item.supplyId,
            supplierId,
            quantity: item.quantity,
            unitPrice,
            unitCost,
            productName: product.name,
            productSku: product.sku ?? undefined,
            variantOptions,
        });
    }
    // Resolve discount
    let discountAmount = 0;
    let discountCodeId = null;
    if (payload.discountCode) {
        const { data: dc } = await supabaseAdmin
            .from('discount_codes')
            .select('id, discount_type, discount_value, min_order_value, max_discount_amount, max_uses, current_uses, uses_per_user, is_active, valid_until')
            .eq('code', payload.discountCode.toUpperCase())
            .eq('is_active', true)
            .single();
        if (!dc)
            throw new BadRequestError('Invalid discount code');
        if (subtotal < Number(dc.min_order_value ?? 0)) {
            throw new BadRequestError(`Minimum order of KES ${dc.min_order_value} required`);
        }
        if (dc.max_uses && dc.current_uses >= dc.max_uses) {
            throw new BadRequestError('Discount code exhausted');
        }
        const dcVal = Number(dc.discount_value);
        discountAmount = dc.discount_type === 'percentage'
            ? Math.min(subtotal * (dcVal / 100), Number(dc.max_discount_amount ?? Infinity))
            : dcVal;
        discountCodeId = dc.id;
    }
    const totalAmount = Math.max(0, subtotal - discountAmount);
    const costTotal = lineItems.reduce((s, i) => s + i.unitCost * i.quantity, 0);
    const orderNumber = `ORD-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
    // Create order — delivery info is stored in shipping_address JSONB
    const { data: order, error: orderErr } = await supabaseAdmin.from('orders').insert({
        order_number: orderNumber,
        user_id: userId,
        status: 'pending_payment',
        shipping_address: payload.deliveryInfo,
        subtotal,
        shipping_fee: 0,
        discount_amount: discountAmount,
        total_amount: totalAmount,
        cost_total: costTotal,
        currency: 'KES',
        discount_code_id: discountCodeId,
        customer_note: payload.notes,
        metadata: payload.idempotencyKey ? { idempotency_key: payload.idempotencyKey } : {},
    }).select('id, order_number').single();
    if (orderErr || !order)
        throw new BadRequestError(orderErr?.message ?? 'Order creation failed');
    // Bulk-insert order items in one round-trip
    const orderId = order.id;
    await supabaseAdmin.from('order_items').insert(lineItems.map((item) => ({
        order_id: orderId,
        product_id: item.productId,
        variant_id: item.variantId ?? null,
        supply_id: item.supplyId ?? null,
        supplier_id: item.supplierId ?? null,
        product_name: item.productName,
        product_sku: item.productSku ?? null,
        variant_options: item.variantOptions ?? null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        unit_cost: item.unitCost,
    })));
    // Increment discount usage
    if (discountCodeId) {
        await supabaseAdmin.from('discount_usage').insert({
            discount_id: discountCodeId, user_id: userId, order_id: orderId,
            discount_amount: discountAmount,
        });
        // Fetch current count and increment atomically
        const { data: dcRow } = await supabaseAdmin
            .from('discount_codes')
            .select('current_uses')
            .eq('id', discountCodeId)
            .single();
        if (dcRow) {
            await supabaseAdmin
                .from('discount_codes')
                .update({ current_uses: (dcRow.current_uses ?? 0) + 1 })
                .eq('id', discountCodeId);
        }
    }
    // Record initial status in history
    await supabaseAdmin.from('order_status_history').insert({
        order_id: orderId,
        from_status: null,
        to_status: 'pending_payment',
        changed_at: new Date().toISOString(),
    });
    ordersCreatedTotal.inc({ status: 'pending_payment' });
    return order;
}
export async function cancelOrder(userId, orderId, reason) {
    const { data: order, error } = await supabaseAdmin
        .from('orders').select('status, user_id').eq('id', orderId).single();
    if (error || !order)
        throw new NotFoundError('Order');
    if (order.user_id !== userId)
        throw new NotFoundError('Order');
    if (!['pending_payment', 'paid', 'awaiting_dispatch'].includes(order.status)) {
        throw new BadRequestError('Order cannot be cancelled at this stage');
    }
    const { data, error: updateErr } = await supabaseAdmin
        .from('orders')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), admin_note: reason })
        .eq('id', orderId)
        .select('id, order_number, status')
        .single();
    if (updateErr || !data)
        throw new BadRequestError('Cancel failed');
    return data;
}
// ─── Admin ─────────────────────────────────────────────────────────────────────
export async function adminListOrders(query) {
    const { page, limit, offset } = parsePage(query);
    let q = supabaseAdmin
        .from('orders')
        .select(`
      id, order_number, user_id, status, payment_status,
      subtotal, shipping_fee, discount_amount, total_amount,
      currency, placed_at, customer_note, shipping_address, metadata,
      user_profiles(first_name, last_name)
    `, { count: 'exact' })
        .order('placed_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (query.status)
        q = q.eq('status', query.status);
    if (query.paymentStatus)
        q = q.eq('payment_status', query.paymentStatus);
    if (query.userId)
        q = q.eq('user_id', query.userId);
    const { data, count, error } = await q;
    if (error)
        throw new BadRequestError(`Orders query failed: ${error.message}`);
    return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
const VALID_TRANSITIONS = {
    pending_payment: ['paid', 'cancelled'],
    paid: ['awaiting_dispatch', 'cancelled'],
    awaiting_dispatch: ['dispatched', 'cancelled'],
    dispatched: ['delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
};
export async function updateOrderStatus(orderId, status, adminNote) {
    const { data: current, error: fetchErr } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, status, user_id')
        .eq('id', orderId)
        .single();
    if (fetchErr || !current)
        throw new NotFoundError('Order');
    const currentStatus = current.status;
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(status)) {
        throw new BadRequestError(`Cannot transition order from '${currentStatus}' to '${status}'`);
    }
    const { data, error } = await supabaseAdmin
        .from('orders')
        .update({ status, admin_note: adminNote })
        .eq('id', orderId)
        .select('id, order_number, status, user_id')
        .single();
    if (error || !data)
        throw new NotFoundError('Order');
    const notifyOn = ['dispatched', 'delivered', 'cancelled'];
    if (notifyOn.includes(status)) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
        if (authUser.user?.email) {
            sendEmail({
                to: [{ email: authUser.user.email }],
                ...templates.orderStatusUpdate(data.order_number, status),
            }).catch(() => { });
        }
    }
    return data;
}
export async function dispatchOrder(orderId, info) {
    const { data: order, error } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, status, user_id, metadata, shipping_address')
        .eq('id', orderId)
        .single();
    if (error || !order)
        throw new NotFoundError('Order');
    const o = order;
    if (!['awaiting_dispatch', 'paid'].includes(o.status)) {
        throw new BadRequestError('Order cannot be dispatched at this stage');
    }
    const dispatchedAt = new Date().toISOString();
    const dispatchInfo = {
        parcelRef: info.parcelRef ?? null,
        trackingNo: info.trackingNo ?? null,
        collectionPoint: info.collectionPoint ?? null,
        dispatchNotes: info.dispatchNotes ?? null,
        dispatchedAt,
    };
    const { data: updated, error: updateErr } = await supabaseAdmin
        .from('orders')
        .update({
        status: 'dispatched',
        metadata: { ...(o.metadata ?? {}), dispatchInfo },
    })
        .eq('id', orderId)
        .select('id, order_number, status, user_id')
        .single();
    if (updateErr || !updated)
        throw new BadRequestError('Dispatch failed');
    const u = updated;
    await supabaseAdmin.from('order_status_history').insert({
        order_id: orderId,
        from_status: o.status,
        to_status: 'dispatched',
        changed_at: dispatchedAt,
        reason: info.dispatchNotes ?? null,
    });
    // Send dispatch notification email
    try {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(o.user_id);
        const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('first_name, last_name')
            .eq('id', o.user_id)
            .maybeSingle();
        const { data: orderItems } = await supabaseAdmin
            .from('order_items')
            .select('product_name, quantity')
            .eq('order_id', orderId);
        const email = authUser.user?.email;
        if (email) {
            const name = profile
                ? `${profile.first_name} ${profile.last_name}`.trim()
                : '';
            sendEmail({
                to: [{ email, name }],
                ...templates.orderDispatched(u.order_number, name, (orderItems ?? []).map((i) => ({
                    name: i.product_name,
                    quantity: i.quantity,
                })), {
                    provider: o.shipping_address.preferredProvider,
                    parcelRef: info.parcelRef,
                    trackingNo: info.trackingNo,
                    collectionPoint: info.collectionPoint,
                    dispatchNotes: info.dispatchNotes,
                }),
            }).catch(() => { });
        }
    }
    catch {
        // Email failure is non-critical
    }
    return u;
}
export async function createGuestOrder(payload) {
    const resolvedItems = [];
    for (const item of payload.items) {
        let resolvedPrice = item.price;
        if (item.productId) {
            const { data: product } = await supabaseAdmin
                .from('products')
                .select('base_price, sale_price, name, status')
                .eq('id', item.productId)
                .eq('status', 'active')
                .maybeSingle();
            if (!product)
                throw new UnprocessableError(`Product ${item.productId} not available`);
            const p = product;
            resolvedPrice = (p.sale_price && p.sale_price > 0) ? Number(p.sale_price) : Number(p.base_price);
        }
        resolvedItems.push({ productId: item.productId, name: item.name, resolvedPrice, quantity: item.quantity });
    }
    const subtotal = resolvedItems.reduce((s, i) => s + i.resolvedPrice * i.quantity, 0);
    const totalAmount = subtotal + payload.shippingFee;
    const guestOrderNumber = `ORD-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
    const { data: order, error } = await supabaseAdmin
        .from('orders')
        .insert({
        order_number: guestOrderNumber,
        status: 'pending_payment',
        shipping_address: {
            recipientName: payload.customerName,
            phone: payload.phone,
            email: payload.email ?? null,
            address: payload.address,
            town: payload.zone === 'nairobi' ? 'Nairobi' : 'Upcountry',
            county: 'Kenya',
            deliveryMethod: 'home_delivery',
        },
        subtotal,
        shipping_fee: payload.shippingFee,
        discount_amount: 0,
        total_amount: totalAmount,
        currency: 'KES',
        metadata: {
            payment_method: payload.payment,
            zone: payload.zone,
            is_guest_order: true,
        },
    })
        .select('id, order_number')
        .single();
    if (error || !order)
        throw new BadRequestError(error?.message ?? 'Order creation failed');
    const orderId = order.id;
    await supabaseAdmin.from('order_items').insert(resolvedItems.map((item) => ({
        order_id: orderId,
        product_id: item.productId ?? null,
        product_name: item.name,
        quantity: item.quantity,
        unit_price: item.resolvedPrice,
    })));
    ordersCreatedTotal.inc({ status: 'pending_payment' });
    return {
        id: orderId,
        orderNumber: order.order_number,
    };
}
// ─── Public order tracking (by order number, no auth) ────────────────────────
export async function trackOrderByNumber(orderNumber) {
    const { data, error } = await supabaseAdmin
        .from('orders')
        .select(`
      id, order_number, status, payment_status,
      subtotal, shipping_fee, total_amount, currency,
      placed_at, metadata, shipping_address,
      order_items(product_name, quantity, unit_price, total_price),
      order_status_history(from_status, to_status, changed_at)
    `)
        .eq('order_number', orderNumber)
        .single();
    if (error || !data)
        throw new NotFoundError('Order');
    return data;
}
