import { supabaseAdmin } from '../config/db.js';
import { sendEmail, templates } from '../config/email.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export async function createShipment(payload: {
  orderId: string; carrier?: string; trackingNumber?: string;
  trackingUrl?: string; estimatedDelivery?: string; notes?: string;
}) {
  const { data: order } = await supabaseAdmin
    .from('orders').select('id, user_id, status').eq('id', payload.orderId).single();
  if (!order) throw new NotFoundError('Order');
  if (!['confirmed', 'processing'].includes((order as { status: string }).status)) {
    throw new BadRequestError('Order must be confirmed or processing to create shipment');
  }

  const { data, error } = await supabaseAdmin.from('shipments').insert({
    order_id:          payload.orderId,
    carrier:           payload.carrier,
    tracking_number:   payload.trackingNumber,
    tracking_url:      payload.trackingUrl,
    estimated_delivery: payload.estimatedDelivery,
    notes:             payload.notes,
    status:            'pending',
  }).select().single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Shipment creation failed');

  await supabaseAdmin.from('orders').update({ status: 'shipped' }).eq('id', payload.orderId);

  // Notify customer
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById((order as { user_id: string }).user_id);
  if (authUser.user?.email) {
    sendEmail({
      to: [{ email: authUser.user.email }],
      ...templates.shipmentDispatched(
        payload.orderId,
        payload.trackingNumber ?? '',
        payload.carrier ?? 'Carrier',
      ),
    }).catch(() => {});
  }

  return data;
}

export async function addTrackingEvent(shipmentId: string, payload: {
  status: string; location?: string; description?: string; occurredAt?: string;
}) {
  const { data, error } = await supabaseAdmin.from('shipment_events').insert({
    shipment_id:  shipmentId,
    status:       payload.status,
    location:     payload.location,
    description:  payload.description,
    occurred_at:  payload.occurredAt ?? new Date().toISOString(),
  }).select().single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Failed to add event');

  await supabaseAdmin.from('shipments').update({ status: payload.status }).eq('id', shipmentId);

  if (payload.status === 'delivered') {
    const { data: shipment } = await supabaseAdmin
      .from('shipments').select('order_id').eq('id', shipmentId).single();
    if (shipment) {
      await supabaseAdmin.from('orders').update({
        status: 'delivered', delivered_at: payload.occurredAt ?? new Date().toISOString(),
      }).eq('id', (shipment as { order_id: string }).order_id);
    }
  }

  return data;
}

export async function getShipmentForOrder(orderId: string) {
  const { data, error } = await supabaseAdmin
    .from('shipments')
    .select('*, shipment_events(status, location, description, occurred_at)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw new NotFoundError('Shipment');
  return data;
}
