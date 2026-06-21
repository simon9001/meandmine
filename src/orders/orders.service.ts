import { supabaseAdmin } from '../config/db.js';
import { sendEmail, templates } from '../config/email.js';
import { ordersCreatedTotal } from '../config/metrics.js';
import { NotFoundError, BadRequestError, UnprocessableError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import type { CheckoutPayload } from '../types/index.js';

export async function listOrders(userId: string, query: { page?: string; limit?: string; status?: string }) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('orders')
    .select('id, order_number, status, payment_status, total_amount, currency, placed_at, delivered_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('placed_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.status) q = q.eq('status', query.status);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getOrder(orderId: string, userId?: string) {
  let q = supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items(id, product_id, variant_id, supply_id, supplier_id, product_name, product_sku, variant_options, quantity, unit_price, total_price, fulfillment_status),
      order_status_history(from_status, to_status, reason, changed_at)
    `)
    .eq('id', orderId);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q.single();
  if (error || !data) throw new NotFoundError('Order');
  return data;
}

export async function createOrder(userId: string, payload: CheckoutPayload, _ip?: string) {
  // Idempotency check
  if (payload.idempotencyKey) {
    const { data: existing } = await supabaseAdmin
      .from('orders')
      .select('id, order_number')
      .eq('metadata->idempotency_key', payload.idempotencyKey)
      .maybeSingle();
    if (existing) return existing;
  }

  // Validate items and compute subtotal
  let subtotal = 0;
  type LineItem = {
    productId: string; variantId?: string; supplyId?: string; supplierId?: string;
    quantity: number; unitPrice: number; unitCost: number;
    productName: string; productSku?: string; variantOptions?: Record<string, unknown>;
  };
  const lineItems: LineItem[] = [];

  for (const item of payload.items) {
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .select('id, name, sku, base_price, sale_price, cost_price, status')
      .eq('id', item.productId)
      .eq('status', 'active')
      .single();
    if (error || !product) throw new UnprocessableError(`Product ${item.productId} not available`);

    let unitPrice = Number((product as { sale_price: number | null; base_price: number }).sale_price ?? (product as { base_price: number }).base_price);
    let variantOptions: Record<string, unknown> | undefined;

    if (item.variantId) {
      const { data: variant } = await supabaseAdmin
        .from('product_variants')
        .select('additional_price, options, is_active')
        .eq('id', item.variantId)
        .single();
      if (!variant || !(variant as { is_active: boolean }).is_active) throw new UnprocessableError(`Variant not available`);
      unitPrice += Number((variant as { additional_price: number }).additional_price ?? 0);
      variantOptions = (variant as { options: Record<string, unknown> }).options;
    }

    // Check inventory
    const { data: inv } = await supabaseAdmin
      .from('inventory')
      .select('available_stock')
      .eq('product_id', item.productId)
      .is('variant_id', item.variantId ?? null)
      .maybeSingle();

    if (inv && (inv as { available_stock: number }).available_stock < item.quantity) {
      throw new UnprocessableError(`Insufficient stock for ${(product as { name: string }).name}`);
    }

    // Resolve supplier from supply
    let supplierId: string | undefined;
    let unitCost = Number((product as { cost_price: number | null }).cost_price ?? 0);
    if (item.supplyId) {
      const { data: supply } = await supabaseAdmin
        .from('product_supply')
        .select('supplier_id, supplier_price')
        .eq('id', item.supplyId)
        .single();
      if (supply) {
        supplierId = (supply as { supplier_id: string }).supplier_id;
        unitCost = Number((supply as { supplier_price: number }).supplier_price);
      }
    }

    subtotal += unitPrice * item.quantity;
    lineItems.push({
      productId:      item.productId,
      variantId:      item.variantId,
      supplyId:       item.supplyId,
      supplierId,
      quantity:       item.quantity,
      unitPrice,
      unitCost,
      productName:    (product as { name: string }).name,
      productSku:     (product as { sku: string | null }).sku ?? undefined,
      variantOptions,
    });
  }

  // Resolve discount
  let discountAmount = 0;
  let discountCodeId: string | null = null;
  if (payload.discountCode) {
    const { data: dc } = await supabaseAdmin
      .from('discount_codes')
      .select('id, discount_type, discount_value, min_order_value, max_discount_amount, max_uses, current_uses, uses_per_user, is_active, valid_until')
      .eq('code', payload.discountCode.toUpperCase())
      .eq('is_active', true)
      .single();
    if (!dc) throw new BadRequestError('Invalid discount code');
    if (subtotal < Number((dc as { min_order_value: number }).min_order_value ?? 0)) {
      throw new BadRequestError(`Minimum order of KES ${(dc as { min_order_value: number }).min_order_value} required`);
    }
    if ((dc as { max_uses: number | null }).max_uses && (dc as { current_uses: number }).current_uses >= (dc as { max_uses: number }).max_uses!) {
      throw new BadRequestError('Discount code exhausted');
    }

    const dcVal = Number((dc as { discount_value: number }).discount_value);
    discountAmount = (dc as { discount_type: string }).discount_type === 'percentage'
      ? Math.min(subtotal * (dcVal / 100), Number((dc as { max_discount_amount: number | null }).max_discount_amount ?? Infinity))
      : dcVal;
    discountCodeId = (dc as { id: string }).id;
  }

  const totalAmount = Math.max(0, subtotal - discountAmount);
  const costTotal   = lineItems.reduce((s, i) => s + i.unitCost * i.quantity, 0);

  const orderNumber = `ORD-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

  // Create order — delivery info is stored in shipping_address JSONB
  const { data: order, error: orderErr } = await supabaseAdmin.from('orders').insert({
    order_number:     orderNumber,
    user_id:          userId,
    status:           'pending_payment',
    shipping_address: payload.deliveryInfo,
    subtotal,
    shipping_fee:     0,
    discount_amount:  discountAmount,
    total_amount:     totalAmount,
    cost_total:       costTotal,
    currency:         'KES',
    discount_code_id: discountCodeId,
    customer_note:    payload.notes,
    metadata:         payload.idempotencyKey ? { idempotency_key: payload.idempotencyKey } : {},
  }).select('id, order_number').single();

  if (orderErr || !order) throw new BadRequestError(orderErr?.message ?? 'Order creation failed');

  // Bulk-insert order items in one round-trip
  const orderId = (order as { id: string }).id;
  await supabaseAdmin.from('order_items').insert(
    lineItems.map((item) => ({
      order_id:        orderId,
      product_id:      item.productId,
      variant_id:      item.variantId ?? null,
      supply_id:       item.supplyId ?? null,
      supplier_id:     item.supplierId ?? null,
      product_name:    item.productName,
      product_sku:     item.productSku ?? null,
      variant_options: item.variantOptions ?? null,
      quantity:        item.quantity,
      unit_price:      item.unitPrice,
      unit_cost:       item.unitCost,
    }))
  );

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
        .update({ current_uses: ((dcRow as { current_uses: number }).current_uses ?? 0) + 1 })
        .eq('id', discountCodeId);
    }
  }

  // Record initial status in history
  await supabaseAdmin.from('order_status_history').insert({
    order_id:    orderId,
    from_status: null,
    to_status:   'pending_payment',
    changed_at:  new Date().toISOString(),
  });

  ordersCreatedTotal.inc({ status: 'pending_payment' });

  return order;
}

export async function cancelOrder(userId: string, orderId: string, reason?: string) {
  const { data: order, error } = await supabaseAdmin
    .from('orders').select('status, user_id').eq('id', orderId).single();
  if (error || !order) throw new NotFoundError('Order');
  if ((order as { user_id: string }).user_id !== userId) throw new NotFoundError('Order');
  if (!['pending_payment', 'paid', 'awaiting_dispatch'].includes((order as { status: string }).status)) {
    throw new BadRequestError('Order cannot be cancelled at this stage');
  }

  const { data, error: updateErr } = await supabaseAdmin
    .from('orders')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), admin_note: reason })
    .eq('id', orderId)
    .select('id, order_number, status')
    .single();
  if (updateErr || !data) throw new BadRequestError('Cancel failed');
  return data;
}

// ─── Admin ─────────────────────────────────────────────────────────────────────

export async function adminListOrders(query: {
  page?: string; limit?: string; status?: string; paymentStatus?: string; userId?: string;
}) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('orders')
    .select(`
      id, order_number, user_id, status, payment_status,
      subtotal, shipping_fee, discount_amount, total_amount,
      currency, placed_at, customer_note, shipping_address, metadata,
      order_items(id, product_id, product_name, quantity, unit_price, total_price, fulfillment_status)
    `, { count: 'exact' })
    .order('placed_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.status)        q = q.eq('status', query.status);
  if (query.paymentStatus) q = q.eq('payment_status', query.paymentStatus);
  if (query.userId)        q = q.eq('user_id', query.userId);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending_payment:   ['paid', 'cancelled'],
  paid:              ['awaiting_dispatch', 'cancelled'],
  awaiting_dispatch: ['dispatched', 'cancelled'],
  dispatched:        ['delivered', 'cancelled'],
  delivered:         [],
  cancelled:         [],
};

export async function updateOrderStatus(orderId: string, status: string, adminNote?: string) {
  const { data: current, error: fetchErr } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, status, user_id')
    .eq('id', orderId)
    .single();
  if (fetchErr || !current) throw new NotFoundError('Order');

  const currentStatus = (current as { status: string }).status;
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
  if (error || !data) throw new NotFoundError('Order');

  const notifyOn = ['dispatched', 'delivered', 'cancelled'];
  if (notifyOn.includes(status)) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById((data as { user_id: string }).user_id);
    if (authUser.user?.email) {
      sendEmail({
        to: [{ email: authUser.user.email }],
        ...templates.orderStatusUpdate((data as { order_number: string }).order_number, status),
      }).catch(() => {});
    }
  }

  return data;
}

export async function dispatchOrder(orderId: string, info: {
  parcelRef?: string;
  trackingNo?: string;
  collectionPoint?: string;
  dispatchNotes?: string;
}) {
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, status, user_id, metadata, shipping_address')
    .eq('id', orderId)
    .single();
  if (error || !order) throw new NotFoundError('Order');

  type OrderRow = {
    id: string; order_number: string; status: string; user_id: string;
    metadata: Record<string, unknown>; shipping_address: Record<string, unknown>;
  };
  const o = order as OrderRow;

  if (!['awaiting_dispatch', 'paid'].includes(o.status)) {
    throw new BadRequestError('Order cannot be dispatched at this stage');
  }

  const dispatchedAt = new Date().toISOString();
  const dispatchInfo = {
    parcelRef:       info.parcelRef ?? null,
    trackingNo:      info.trackingNo ?? null,
    collectionPoint: info.collectionPoint ?? null,
    dispatchNotes:   info.dispatchNotes ?? null,
    dispatchedAt,
  };

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('orders')
    .update({
      status:   'dispatched',
      metadata: { ...(o.metadata ?? {}), dispatchInfo },
    })
    .eq('id', orderId)
    .select('id, order_number, status, user_id')
    .single();

  if (updateErr || !updated) throw new BadRequestError('Dispatch failed');
  const u = updated as { id: string; order_number: string; status: string; user_id: string };

  await supabaseAdmin.from('order_status_history').insert({
    order_id:    orderId,
    from_status: o.status,
    to_status:   'dispatched',
    changed_at:  dispatchedAt,
    reason:      info.dispatchNotes ?? null,
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
        ? `${(profile as { first_name: string }).first_name} ${(profile as { last_name: string }).last_name}`.trim()
        : '';

      sendEmail({
        to: [{ email, name }],
        ...templates.orderDispatched(
          u.order_number,
          name,
          (orderItems ?? []).map((i: { product_name: string; quantity: number }) => ({
            name:     i.product_name,
            quantity: i.quantity,
          })),
          {
            provider:        (o.shipping_address as { preferredProvider?: string }).preferredProvider,
            parcelRef:       info.parcelRef,
            trackingNo:      info.trackingNo,
            collectionPoint: info.collectionPoint,
            dispatchNotes:   info.dispatchNotes,
          },
        ),
      }).catch(() => {});
    }
  } catch {
    // Email failure is non-critical
  }

  return u;
}

// ─── Guest checkout (no auth required) ───────────────────────────────────────

export interface GuestOrderItem {
  name:     string;
  price:    number;
  quantity: number;
}

export interface GuestCheckoutPayload {
  items:        GuestOrderItem[];
  customerName: string;
  phone:        string;
  email?:       string;
  address:      string;
  zone:         'nairobi' | 'upcountry';
  payment:      'mpesa' | 'cod';
  shippingFee:  number;
}

export async function createGuestOrder(payload: GuestCheckoutPayload) {
  const subtotal    = payload.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const totalAmount = subtotal + payload.shippingFee;
  const guestOrderNumber = `ORD-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .insert({
      order_number:    guestOrderNumber,
      status:          'pending_payment',
      shipping_address: {
        recipientName:  payload.customerName,
        phone:          payload.phone,
        email:          payload.email ?? null,
        address:        payload.address,
        town:           payload.zone === 'nairobi' ? 'Nairobi' : 'Upcountry',
        county:         'Kenya',
        deliveryMethod: 'home_delivery',
      },
      subtotal,
      shipping_fee:    payload.shippingFee,
      discount_amount: 0,
      total_amount:    totalAmount,
      currency:        'KES',
      metadata: {
        payment_method: payload.payment,
        zone:           payload.zone,
        is_guest_order: true,
      },
    })
    .select('id, order_number')
    .single();

  if (error || !order) throw new BadRequestError(error?.message ?? 'Order creation failed');

  const orderId = (order as { id: string }).id;

  for (const item of payload.items) {
    await supabaseAdmin.from('order_items').insert({
      order_id:     orderId,
      product_name: item.name,
      quantity:     item.quantity,
      unit_price:   item.price,
    });
  }

  ordersCreatedTotal.inc({ status: 'pending_payment' });

  return {
    id:          orderId,
    orderNumber: (order as { order_number: string }).order_number,
  };
}

// ─── Public order tracking (by order number, no auth) ────────────────────────

export async function trackOrderByNumber(orderNumber: string) {
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

  if (error || !data) throw new NotFoundError('Order');
  return data;
}
