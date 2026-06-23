import { supabaseAdmin } from '../config/db.js';
import { productViewsTotal } from '../config/metrics.js';
export async function trackEvent(payload) {
    if (payload.eventType === 'product_view') {
        productViewsTotal.inc();
        if (payload.productId) {
            supabaseAdmin
                .from('products')
                .update({ view_count: supabaseAdmin.rpc('increment_view_count', { p_id: payload.productId }) })
                .eq('id', payload.productId)
                .then(() => { });
        }
    }
    // Fire-and-forget event insert
    supabaseAdmin.from('analytics_events').insert({
        event_type: payload.eventType,
        user_id: payload.userId ?? null,
        session_id: payload.sessionId ?? null,
        product_id: payload.productId ?? null,
        order_id: payload.orderId ?? null,
        search_query: payload.searchQuery ?? null,
        properties: payload.properties ?? {},
        ip_address: payload.ip ?? null,
        user_agent: payload.userAgent ?? null,
    }).then(() => { });
}
