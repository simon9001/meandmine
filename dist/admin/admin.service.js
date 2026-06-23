import { supabaseAdmin } from '../config/db.js';
import { BadRequestError } from '../utils/errors.js';
import { buildKey, cacheGet, cacheSet } from '../utils/cache.js';
const TTL = {
    stats: 60, // 1 min  — admins want near-real-time counts
    revenue: 300, // 5 min  — daily revenue chart
    topProducts: 300, // 5 min
    lowStock: 120, // 2 min  — stock levels
};
export async function getDashboardStats() {
    const key = buildKey('admin:stats');
    const cached = await cacheGet(key);
    if (cached)
        return cached;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    // Use { head: true } = COUNT(*) only, no rows fetched — eliminates full table scans
    const [totalOrders, pendingOrders, shippedOrders, deliveredOrders, totalProducts, activeProducts, totalUsers, revenue,] = await Promise.all([
        supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'awaiting_dispatch'),
        supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'dispatched'),
        supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'delivered'),
        supabaseAdmin.from('products').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('products').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabaseAdmin.from('user_profiles').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('orders')
            .select('total_amount')
            .eq('payment_status', 'paid')
            .gte('placed_at', thirtyDaysAgo),
    ]);
    const totalRevenue30d = (revenue.data ?? []).reduce((sum, o) => sum + Number(o.total_amount), 0);
    const result = {
        orders: {
            total: totalOrders.count ?? 0,
            pending: pendingOrders.count ?? 0,
            shipped: shippedOrders.count ?? 0,
            delivered: deliveredOrders.count ?? 0,
        },
        products: {
            total: totalProducts.count ?? 0,
            active: activeProducts.count ?? 0,
            archived: (totalProducts.count ?? 0) - (activeProducts.count ?? 0),
        },
        users: { total: totalUsers.count ?? 0 },
        revenue30d: totalRevenue30d,
    };
    await cacheSet(key, result, TTL.stats);
    return result;
}
export async function getDailyRevenue(days = 30) {
    const key = buildKey('admin:revenue', days);
    const cached = await cacheGet(key);
    if (cached)
        return cached;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
        .from('orders')
        .select('placed_at, total_amount')
        .eq('payment_status', 'paid')
        .gte('placed_at', since)
        .order('placed_at', { ascending: false });
    if (error) {
        console.warn('[analytics] getDailyRevenue error:', error.message);
        return [];
    }
    const byDate = {};
    for (const row of data ?? []) {
        const date = row.placed_at.slice(0, 10);
        byDate[date] = (byDate[date] ?? 0) + Number(row.total_amount);
    }
    const result = Object.entries(byDate)
        .map(([date, revenue]) => ({ date, revenue }))
        .sort((a, b) => b.date.localeCompare(a.date));
    await cacheSet(key, result, TTL.revenue);
    return result;
}
export async function getTopProducts(limit = 10) {
    const key = buildKey('admin:top_products', limit);
    const cached = await cacheGet(key);
    if (cached)
        return cached;
    const { data, error } = await supabaseAdmin
        .from('order_items')
        .select('product_id, quantity, unit_price, products(name, sku)');
    if (error) {
        console.warn('[analytics] getTopProducts error:', error.message);
        return [];
    }
    const byProduct = {};
    for (const row of data ?? []) {
        const id = row.product_id;
        const product = row.products;
        if (!byProduct[id]) {
            byProduct[id] = { product_id: id, name: product?.name ?? '', sku: product?.sku ?? null, total_qty: 0, total_revenue: 0 };
        }
        byProduct[id].total_qty += Number(row.quantity);
        byProduct[id].total_revenue += Number(row.unit_price) * Number(row.quantity);
    }
    const result = Object.values(byProduct)
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, limit);
    await cacheSet(key, result, TTL.topProducts);
    return result;
}
export async function refreshMaterializedViews() {
    const views = ['admin.mv_daily_revenue', 'admin.mv_top_products', 'admin.mv_supplier_performance', 'admin.mv_product_stats'];
    // Run all refreshes in parallel — was sequential (4× slower)
    await Promise.all(views.map((view) => supabaseAdmin.rpc('refresh_materialized_view', { view_name: view })));
    return { refreshed: views };
}
export async function getLowStockSummary(threshold = 5) {
    const key = buildKey('admin:low_stock', threshold);
    const cached = await cacheGet(key);
    if (cached)
        return cached;
    const { data, error } = await supabaseAdmin
        .from('inventory')
        .select('product_id, variant_id, available_stock, products(name, sku)')
        .lte('available_stock', threshold)
        .order('available_stock', { ascending: true });
    if (error)
        throw new BadRequestError(error.message);
    const result = data ?? [];
    await cacheSet(key, result, TTL.lowStock);
    return result;
}
