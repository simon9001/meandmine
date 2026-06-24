import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import { logAudit } from './audit.js';

// ─── Audit logs ───────────────────────────────────────────────────────────────

export async function listAuditLogs(query: {
  page?: string;
  limit?: string;
  action?: string;
  resourceType?: string;
  actorRole?: string;
  search?: string;
}) {
  const { page, limit, offset } = parsePage(query);

  let q = (supabaseAdmin as unknown as {
    from: (t: string) => unknown
  }).from('audit_logs') as ReturnType<typeof supabaseAdmin.from>;

  q = (q as unknown as { select: (s: string, o?: object) => unknown })
    .select('id, actor_id, actor_email, actor_role, action, resource_type, resource_id, details, ip_address, created_at', { count: 'exact' }) as ReturnType<typeof supabaseAdmin.from>;

  if (query.action)       q = (q as unknown as { eq: (c: string, v: string) => unknown }).eq('action', query.action) as ReturnType<typeof supabaseAdmin.from>;
  if (query.resourceType) q = (q as unknown as { eq: (c: string, v: string) => unknown }).eq('resource_type', query.resourceType) as ReturnType<typeof supabaseAdmin.from>;
  if (query.actorRole)    q = (q as unknown as { eq: (c: string, v: string) => unknown }).eq('actor_role', query.actorRole) as ReturnType<typeof supabaseAdmin.from>;
  if (query.search) {
    const s = `%${query.search}%`;
    q = (q as unknown as { or: (f: string) => unknown }).or(`actor_email.ilike.${s},action.ilike.${s},resource_id.ilike.${s}`) as ReturnType<typeof supabaseAdmin.from>;
  }

  const result = await (q as unknown as {
    order: (c: string, o: object) => { range: (a: number, b: number) => Promise<{ data: unknown[]; count: number | null }> }
  }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  return {
    data: result.data ?? [],
    meta: { total: result.count ?? 0, page, limit },
  };
}

// ─── Detailed analytics (superadmin only) ────────────────────────────────────

export async function getDetailedAnalytics() {
  const now       = new Date();
  const days7ago  = new Date(now.getTime() - 7  * 86400000).toISOString();
  const days30ago = new Date(now.getTime() - 30 * 86400000).toISOString();
  const days90ago = new Date(now.getTime() - 90 * 86400000).toISOString();

  const [
    // Revenue
    allTimeRevenue,
    revenue7d,
    revenue30d,
    revenue90d,
    // Orders
    allOrders,
    paidOrders,
    failedPayments,
    // Users
    allUsers,
    usersByRole,
    newUsers7d,
    newUsers30d,
    // Payment methods
    paymentsRaw,
    // Top customers
    topCustomers,
    // Category revenue
    categoryRevenue,
    // Recent 90-day daily revenue
    daily90,
    // Weekly new users (last 12 weeks)
    weeklyUsers,
  ] = await Promise.all([
    supabaseAdmin.from('orders').select('total_amount').eq('payment_status', 'paid'),
    supabaseAdmin.from('orders').select('total_amount').eq('payment_status', 'paid').gte('placed_at', days7ago),
    supabaseAdmin.from('orders').select('total_amount').eq('payment_status', 'paid').gte('placed_at', days30ago),
    supabaseAdmin.from('orders').select('total_amount').eq('payment_status', 'paid').gte('placed_at', days90ago),

    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('payment_status', 'paid'),
    supabaseAdmin.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'failed'),

    supabaseAdmin.from('user_profiles').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('user_profiles').select('role'),
    supabaseAdmin.from('user_profiles').select('id', { count: 'exact', head: true }).gte('created_at', days7ago),
    supabaseAdmin.from('user_profiles').select('id', { count: 'exact', head: true }).gte('created_at', days30ago),

    supabaseAdmin.from('payments').select('payment_method, amount').eq('status', 'paid'),

    supabaseAdmin
      .from('orders')
      .select('user_id, total_amount')
      .eq('payment_status', 'paid')
      .order('total_amount', { ascending: false })
      .limit(100),

    supabaseAdmin
      .from('order_items')
      .select('unit_price, quantity, products(name, categories(name))'),

    supabaseAdmin
      .from('orders')
      .select('placed_at, total_amount')
      .eq('payment_status', 'paid')
      .gte('placed_at', days90ago)
      .order('placed_at', { ascending: true }),

    supabaseAdmin
      .from('user_profiles')
      .select('created_at')
      .gte('created_at', new Date(now.getTime() - 84 * 86400000).toISOString())
      .order('created_at', { ascending: true }),
  ]);

  // ── Revenue totals ──
  const sum = (rows: { total_amount: number }[] | null) =>
    (rows ?? []).reduce((s, r) => s + Number(r.total_amount), 0);

  // ── Conversion rate ──
  const conversionRate = allOrders.count && allOrders.count > 0
    ? Math.round(((paidOrders.count ?? 0) / allOrders.count) * 100)
    : 0;

  // ── Role breakdown ──
  const roleCount: Record<string, number> = {};
  for (const u of usersByRole.data ?? []) {
    const role = (u as { role: string }).role;
    roleCount[role] = (roleCount[role] ?? 0) + 1;
  }

  // ── Payment method breakdown ──
  const methodTotals: Record<string, { count: number; revenue: number }> = {};
  for (const p of paymentsRaw.data ?? []) {
    const method = (p as { payment_method: string | null }).payment_method ?? 'unknown';
    const label  = method === 'mobile_money' ? 'M-Pesa' : method === 'card' ? 'Card' : 'Other';
    if (!methodTotals[label]) methodTotals[label] = { count: 0, revenue: 0 };
    methodTotals[label].count++;
    methodTotals[label].revenue += Number((p as { amount: number }).amount);
  }
  const paymentMethods = Object.entries(methodTotals).map(([method, v]) => ({ method, ...v }));

  // ── Category revenue ──
  const catRevMap: Record<string, number> = {};
  for (const item of categoryRevenue.data ?? []) {
    const p     = item as unknown as { unit_price: number; quantity: number; products: { categories: { name: string } | null } | null };
    const cat   = p.products?.categories?.name ?? 'Uncategorised';
    catRevMap[cat] = (catRevMap[cat] ?? 0) + Number(p.unit_price) * Number(p.quantity);
  }
  const revenueByCategory = Object.entries(catRevMap)
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  // ── Top customers ──
  const custMap: Record<string, number> = {};
  for (const o of topCustomers.data ?? []) {
    const uid = (o as { user_id: string }).user_id;
    custMap[uid] = (custMap[uid] ?? 0) + Number((o as { total_amount: number }).total_amount);
  }
  const topCustomerIds = Object.entries(custMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Fetch names for top customer ids
  let topCustomerRows: { id: string; name: string; totalSpend: number }[] = [];
  if (topCustomerIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('id, first_name, last_name')
      .in('id', topCustomerIds.map(([id]) => id));

    const profileMap = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    topCustomerRows = topCustomerIds.map(([id, spend]) => {
      const prof = profileMap.get(id);
      return {
        id,
        name: prof ? `${(prof as { first_name: string }).first_name} ${(prof as { last_name: string }).last_name}`.trim() : 'Unknown',
        totalSpend: spend,
      };
    });
  }

  // ── Daily revenue (90d) ──
  const dailyMap: Record<string, number> = {};
  for (const o of daily90.data ?? []) {
    const date = ((o as { placed_at: string }).placed_at).slice(0, 10);
    dailyMap[date] = (dailyMap[date] ?? 0) + Number((o as { total_amount: number }).total_amount);
  }
  const dailyRevenue = Object.entries(dailyMap)
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Weekly new users ──
  const weekMap: Record<string, number> = {};
  for (const u of weeklyUsers.data ?? []) {
    const d    = new Date((u as { created_at: string }).created_at);
    // ISO week start (Monday)
    const mon  = new Date(d);
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const week = mon.toISOString().slice(0, 10);
    weekMap[week] = (weekMap[week] ?? 0) + 1;
  }
  const weeklyNewUsers = Object.entries(weekMap)
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-12);

  return {
    revenue: {
      allTime: sum(allTimeRevenue.data as { total_amount: number }[]),
      last7d:  sum(revenue7d.data  as { total_amount: number }[]),
      last30d: sum(revenue30d.data as { total_amount: number }[]),
      last90d: sum(revenue90d.data as { total_amount: number }[]),
    },
    orders: {
      total:          allOrders.count   ?? 0,
      paid:           paidOrders.count  ?? 0,
      failedPayments: failedPayments.count ?? 0,
      conversionRate,
    },
    users: {
      total:     allUsers.count  ?? 0,
      newLast7d: newUsers7d.count  ?? 0,
      newLast30d:newUsers30d.count ?? 0,
      byRole:    roleCount,
    },
    paymentMethods,
    revenueByCategory,
    topCustomers: topCustomerRows,
    dailyRevenue,
    weeklyNewUsers,
  };
}

// ─── Super admin delete (can delete admin-role users) ─────────────────────────

export async function superadminDeleteUser(actorId: string, actorEmail: string, targetId: string) {
  if (actorId === targetId) throw new ForbiddenError('Cannot delete your own account');

  const { data: target } = await supabaseAdmin
    .from('user_profiles')
    .select('role, first_name, last_name')
    .eq('id', targetId)
    .single();

  if (!target) throw new NotFoundError('User');

  const t = target as { role: string; first_name: string; last_name: string };
  if (t.role === 'superadmin') throw new ForbiddenError('Cannot delete another superadmin');

  const { error } = await supabaseAdmin.auth.admin.deleteUser(targetId);
  if (error) throw new BadRequestError(error.message);

  logAudit({
    actorId,
    actorEmail,
    actorRole:    'superadmin',
    action:       'user.deleted',
    resourceType: 'user',
    resourceId:   targetId,
    details:      { deletedRole: t.role, deletedName: `${t.first_name} ${t.last_name}` },
  });
}
