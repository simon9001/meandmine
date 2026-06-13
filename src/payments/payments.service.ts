import crypto from 'crypto';
import { supabaseAdmin } from '../config/db.js';
import { env } from '../config/env.js';
import { paymentsProcessedTotal } from '../config/metrics.js';
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

  // Record pending payment
  await supabaseAdmin.from('payments').insert({
    order_id:          orderId,
    user_id:           userId,
    provider:          'paystack',
    provider_ref:      data.reference,
    amount:            (order as { total_amount: number }).total_amount,
    currency:          'KES',
    status:            'pending',
    checkout_url:      data.authorization_url,
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
  if ((payment as { status: string }).status === 'paid') return payment;

  if (data.status !== 'success') {
    await supabaseAdmin.from('payments').update({ status: 'failed' }).eq('id', (payment as { id: string }).id);
    paymentsProcessedTotal.inc({ provider: 'paystack', status: 'failed' });
    throw new UnprocessableError('Payment was not successful');
  }

  const expectedKobo = Math.round((payment as { amount: number }).amount * 100);
  if (data.amount < expectedKobo) throw new UnprocessableError('Amount mismatch — possible fraud');

  await supabaseAdmin.from('payments').update({
    status:          'paid',
    provider_data:   data,
    paid_at:         data.paid_at,
    payment_method:  data.authorization?.channel,
  }).eq('id', (payment as { id: string }).id);

  await supabaseAdmin.from('orders').update({
    payment_status: 'paid',
    status:         'confirmed',
    paid_at:        data.paid_at,
  }).eq('id', (payment as { order_id: string }).order_id);

  paymentsProcessedTotal.inc({ provider: 'paystack', status: 'paid' });
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
      .from('payments').select('id, order_id, amount, status').eq('provider_ref', ref).maybeSingle();
    if (!payment || (payment as { status: string }).status === 'paid') return { received: true };

    const paidAt = (event.data.paid_at ?? new Date().toISOString()) as string;
    await supabaseAdmin.from('payments').update({
      status: 'paid', paid_at: paidAt, provider_data: event.data,
      payment_method: (event.data.authorization as { channel: string } | undefined)?.channel,
    }).eq('id', (payment as { id: string }).id);

    await supabaseAdmin.from('orders').update({
      payment_status: 'paid', status: 'confirmed', paid_at: paidAt,
    }).eq('id', (payment as { order_id: string }).order_id);

    paymentsProcessedTotal.inc({ provider: 'paystack', status: 'paid' });
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
