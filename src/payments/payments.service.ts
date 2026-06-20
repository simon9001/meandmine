import crypto from 'crypto';
import { supabaseAdmin } from '../config/db.js';
import { env } from '../config/env.js';
import { paymentsProcessedTotal } from '../config/metrics.js';
import { sendEmail, templates } from '../config/email.js';
import { NotFoundError, BadRequestError, UnprocessableError } from '../utils/errors.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

async function paystackRequest(path: string, method = 'GET', body?: Record<string, unknown>) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as { status: boolean; message: string; data: unknown };
  if (!json.status) throw new UnprocessableError(json.message ?? 'Paystack error');
  return json.data;
}

// ─── Shared post-payment logic ────────────────────────────────────────────────
// Called by both verifyPayment (frontend path) and handleWebhook (Paystack push).
// Guaranteed idempotent by the caller's 'already paid' guard.

async function handlePaymentConfirmed(opts: {
  paymentId: string;
  orderId: string;
  userId: string;
  paidAt: string;
  providerData?: Record<string, unknown>;
  paymentMethod?: string;
}) {
  const { paymentId, orderId, userId, paidAt, providerData, paymentMethod } = opts;

  // Update payment record
  await supabaseAdmin.from('payments').update({
    status:         'paid',
    provider_data:  providerData,
    paid_at:        paidAt,
    payment_method: paymentMethod,
  }).eq('id', paymentId);

  // Confirm the order
  await supabaseAdmin.from('orders').update({
    payment_status: 'paid',
    status:         'confirmed',
    paid_at:        paidAt,
  }).eq('id', orderId);

  // Fetch order details (number, total, line items) for inventory + email
  const { data: orderData } = await supabaseAdmin
    .from('orders')
    .select('order_number, total_amount, order_items(product_name, product_id, variant_id, quantity, unit_price)')
    .eq('id', orderId)
    .single();

  // Decrement inventory for each confirmed item
  if (orderData) {
    type RawItem = { product_id: string; variant_id: string | null; quantity: number };
    const orderItems = (orderData as unknown as { order_items: RawItem[] }).order_items ?? [];

    for (const item of orderItems) {
      try {
        const { data: inv } = await supabaseAdmin
          .from('inventory')
          .select('id, available_stock')
          .eq('product_id', item.product_id)
          .is('variant_id', item.variant_id ?? null)
          .maybeSingle();

        if (inv) {
          const newStock = Math.max(
            0,
            (inv as { id: string; available_stock: number }).available_stock - item.quantity,
          );
          await supabaseAdmin
            .from('inventory')
            .update({ available_stock: newStock })
            .eq('id', (inv as { id: string }).id);
        }
      } catch {
        // Inventory decrement is non-critical — log and continue
      }
    }
  }

  // Clear the user's cart now that the order is paid
  try {
    const { data: cart } = await supabaseAdmin
      .from('carts')
      .select('id')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cart) {
      await supabaseAdmin.from('cart_items').delete().eq('cart_id', (cart as { id: string }).id);
    }
  } catch {
    // Cart clearing is non-critical
  }

  // Send payment-confirmed email (non-blocking — never throws)
  try {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('id', userId)
      .maybeSingle();

    const email = authUser.user?.email;
    if (email && orderData) {
      const name = profile
        ? `${(profile as { first_name: string }).first_name} ${(profile as { last_name: string }).last_name}`.trim()
        : '';

      type RawItem = { product_name: string; quantity: number; unit_price: number };
      const od = orderData as unknown as {
        order_number: string;
        total_amount: number;
        order_items: RawItem[];
      };

      sendEmail({
        to: [{ email, name }],
        ...templates.paymentConfirmed(
          od.order_number,
          od.total_amount,
          name,
          (od.order_items ?? []).map((i) => ({
            name:     i.product_name,
            quantity: i.quantity,
            price:    i.unit_price,
          })),
        ),
      }).catch(() => {});
    }
  } catch {
    // Email failure must never break the payment confirmation response
  }

  paymentsProcessedTotal.inc({ provider: 'paystack', status: 'paid' });
}

// ─── Public service functions ─────────────────────────────────────────────────

export async function initializePayment(userId: string, orderId: string) {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, total_amount, payment_status, user_id')
    .eq('id', orderId)
    .eq('user_id', userId)
    .single();
  if (!order) throw new NotFoundError('Order');
  if ((order as { payment_status: string }).payment_status === 'paid') {
    throw new BadRequestError('Order already paid');
  }

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = authUser.user?.email;
  if (!email) throw new BadRequestError('User email not found');

  const amountKobo = Math.round((order as { total_amount: number }).total_amount * 100);

  const data = await paystackRequest('/transaction/initialize', 'POST', {
    email,
    amount: amountKobo,
    currency: 'KES',
    reference: `ORD-${(order as { order_number: string }).order_number}-${Date.now()}`,
    metadata: { order_id: orderId, user_id: userId, order_number: (order as { order_number: string }).order_number },
    callback_url: `${env.FRONTEND_URL}/orders/${orderId}/confirm`,
  }) as { reference: string; authorization_url: string; access_code: string };

  await supabaseAdmin.from('payments').insert({
    order_id:     orderId,
    user_id:      userId,
    provider:     'paystack',
    provider_ref: data.reference,
    amount:       (order as { total_amount: number }).total_amount,
    currency:     'KES',
    status:       'pending',
    checkout_url: data.authorization_url,
  });

  return { authorizationUrl: data.authorization_url, reference: data.reference };
}

export async function verifyPayment(reference: string, userId: string) {
  const data = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`) as {
    status: string; amount: number; currency: string; paid_at: string;
    metadata: { order_id: string };
    authorization: { channel: string; card_type: string; last4: string; bank: string; exp_month: string; exp_year: string };
  };

  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('id, order_id, amount, status, user_id')
    .eq('provider_ref', reference)
    .single();

  if (!payment || (payment as { user_id: string }).user_id !== userId) throw new NotFoundError('Payment');

  // Idempotent — already processed
  if ((payment as { status: string }).status === 'paid') return payment;

  if (data.status !== 'success') {
    await supabaseAdmin.from('payments').update({ status: 'failed' }).eq('id', (payment as { id: string }).id);
    paymentsProcessedTotal.inc({ provider: 'paystack', status: 'failed' });
    throw new UnprocessableError('Payment was not successful');
  }

  const expectedKobo = Math.round((payment as { amount: number }).amount * 100);
  if (data.amount < expectedKobo) throw new UnprocessableError('Amount mismatch — possible fraud');

  await handlePaymentConfirmed({
    paymentId:     (payment as { id: string }).id,
    orderId:       (payment as { order_id: string }).order_id,
    userId,
    paidAt:        data.paid_at,
    providerData:  data as unknown as Record<string, unknown>,
    paymentMethod: data.authorization?.channel,
  });

  return payment;
}

export async function handleWebhook(rawBody: string, signature: string) {
  const expected = crypto
    .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  if (expected !== signature) throw new BadRequestError('Invalid webhook signature');

  const event = JSON.parse(rawBody) as { event: string; data: Record<string, unknown> };

  if (event.event === 'charge.success') {
    const ref = event.data.reference as string;

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('id, order_id, amount, status, user_id')
      .eq('provider_ref', ref)
      .maybeSingle();

    // Unknown ref or already processed — acknowledge and exit
    if (!payment || (payment as { status: string }).status === 'paid') return { received: true };

    const paidAt = (event.data.paid_at ?? new Date().toISOString()) as string;

    await handlePaymentConfirmed({
      paymentId:     (payment as { id: string }).id,
      orderId:       (payment as { order_id: string }).order_id,
      userId:        (payment as { user_id: string }).user_id,
      paidAt,
      providerData:  event.data,
      paymentMethod: (event.data.authorization as { channel: string } | undefined)?.channel,
    });
  }

  return { received: true };
}

export async function getPaymentForOrder(orderId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('payments')
    .select('id, provider, provider_ref, amount, currency, status, payment_method, paid_at, checkout_url')
    .eq('order_id', orderId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw new NotFoundError('Payment');
  return data;
}
