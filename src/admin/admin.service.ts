import { supabaseAdmin } from '../config/db.js';
import { BadRequestError } from '../utils/errors.js';

export async function getDashboardStats() {
  const [orders, products, users, revenue] = await Promise.all([
    supabaseAdmin.from('orders').select('id, status, total_amount, placed_at', { count: 'exact' }),
    supabaseAdmin.from('products').select('id, status', { count: 'exact' }),
    supabaseAdmin.from('user_profiles').select('id', { count: 'exact' }),
    supabaseAdmin.from('orders')
      .select('total_amount')
      .eq('payment_status', 'paid')
      .gte('placed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const totalRevenue30d = (revenue.data ?? []).reduce(
    (sum, o) => sum + Number((o as { total_amount: number }).total_amount), 0,
  );

  return {
    orders: {
      total:     orders.count ?? 0,
      pending:   (orders.data ?? []).filter(o => (o as { status: string }).status === 'awaiting_dispatch').length,
      shipped:   (orders.data ?? []).filter(o => (o as { status: string }).status === 'dispatched').length,
      delivered: (orders.data ?? []).filter(o => (o as { status: string }).status === 'delivered').length,
    },
    products: {
      total:    products.count ?? 0,
      active:   (products.data ?? []).filter(p => (p as { status: string }).status === 'active').length,
      archived: (products.data ?? []).filter(p => (p as { status: string }).status === 'archived').length,
    },
    users:        { total: users.count ?? 0 },
    revenue30d:   totalRevenue30d,
  };
}

export async function getDailyRevenue(days = 30) {
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
  // Aggregate by date client-side
  const byDate: Record<string, number> = {};
  for (const row of data ?? []) {
    const date = (row.placed_at as string).slice(0, 10);
    byDate[date] = (byDate[date] ?? 0) + Number(row.total_amount);
  }
  return Object.entries(byDate)
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function getTopProducts(limit = 10) {
  const { data, error } = await supabaseAdmin
    .from('order_items')
    .select('product_id, quantity, unit_price, products(name, sku)');
  if (error) {
    console.warn('[analytics] getTopProducts error:', error.message);
    return [];
  }
  // Aggregate by product client-side
  const byProduct: Record<string, { product_id: string; name: string; sku: string | null; total_qty: number; total_revenue: number }> = {};
  for (const row of data ?? []) {
    const id = row.product_id as string;
    const product = row.products as unknown as { name: string; sku: string | null } | null;
    if (!byProduct[id]) {
      byProduct[id] = { product_id: id, name: product?.name ?? '', sku: product?.sku ?? null, total_qty: 0, total_revenue: 0 };
    }
    byProduct[id].total_qty     += Number(row.quantity);
    byProduct[id].total_revenue += Number(row.unit_price) * Number(row.quantity);
  }
  return Object.values(byProduct)
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, limit);
}

export async function refreshMaterializedViews() {
  const views = ['admin.mv_daily_revenue', 'admin.mv_top_products', 'admin.mv_supplier_performance', 'admin.mv_product_stats'];
  for (const view of views) {
    await supabaseAdmin.rpc('refresh_materialized_view' as never, { view_name: view });
  }
  return { refreshed: views };
}

export async function getLowStockSummary(threshold = 5) {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('product_id, variant_id, available_stock, products(name, sku)')
    .lte('available_stock' as 'id', threshold)
    .order('available_stock' as 'id', { ascending: true });
  if (error) throw new BadRequestError(error.message);
  return data ?? [];
}
