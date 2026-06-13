import { supabaseAdmin } from '../config/db.js';
import { productViewsTotal } from '../config/metrics.js';

type EventType = 'page_view' | 'product_view' | 'add_to_cart' | 'remove_from_cart' | 'begin_checkout' | 'purchase' | 'search';

export async function trackEvent(payload: {
  eventType: EventType;
  userId?: string;
  sessionId?: string;
  productId?: string;
  orderId?: string;
  searchQuery?: string;
  properties?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}) {
  if (payload.eventType === 'product_view') {
    productViewsTotal.inc();

    if (payload.productId) {
      supabaseAdmin
        .from('products')
        .update({ view_count: supabaseAdmin.rpc('increment_view_count' as never, { p_id: payload.productId }) } as Record<string, unknown>)
        .eq('id', payload.productId)
        .then(() => {});
    }
  }

  // Fire-and-forget event insert
  supabaseAdmin.from('analytics_events' as 'orders').insert({
    event_type:   payload.eventType,
    user_id:      payload.userId ?? null,
    session_id:   payload.sessionId ?? null,
    product_id:   payload.productId ?? null,
    order_id:     payload.orderId ?? null,
    search_query: payload.searchQuery ?? null,
    properties:   payload.properties ?? {},
    ip_address:   payload.ip ?? null,
    user_agent:   payload.userAgent ?? null,
  } as Record<string, unknown>).then(() => {});
}
