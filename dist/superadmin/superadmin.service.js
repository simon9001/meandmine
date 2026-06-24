import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import { logAudit } from './audit.js';
// ─── Audit logs ───────────────────────────────────────────────────────────────
export async function listAuditLogs(query) {
    const { page, limit, offset } = parsePage(query);
    let q = supabaseAdmin.from('audit_logs');
    q = q
        .select('id, actor_id, actor_email, actor_role, action, resource_type, resource_id, details, ip_address, created_at', { count: 'exact' });
    if (query.action)
        q = q.eq('action', query.action);
    if (query.resourceType)
        q = q.eq('resource_type', query.resourceType);
    if (query.actorRole)
        q = q.eq('actor_role', query.actorRole);
    if (query.search) {
        const s = `%${query.search}%`;
        q = q.or(`actor_email.ilike.${s},action.ilike.${s},resource_id.ilike.${s}`);
    }
    const result = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    return {
        data: result.data ?? [],
        meta: { total: result.count ?? 0, page, limit },
    };
}
// ─── Detailed analytics (superadmin only) ────────────────────────────────────
export async function getDetailedAnalytics() {
    const now = new Date();
    const days7ago = new Date(now.getTime() - 7 * 86400000).toISOString();
    const days30ago = new Date(now.getTime() - 30 * 86400000).toISOString();
    const days90ago = new Date(now.getTime() - 90 * 86400000).toISOString();
    const [
    // Revenue
    allTimeRevenue, revenue7d, revenue30d, revenue90d, 
    // Orders
    allOrders, paidOrders, failedPayments, 
    // Users
    allUsers, usersByRole, newUsers7d, newUsers30d, 
    // Payment methods
    paymentsRaw, 
    // Top customers
    topCustomers, 
    // Category revenue
    categoryRevenue, 
    // Recent 90-day daily revenue
    daily90, 
    // Weekly new users (last 12 weeks)
    weeklyUsers,] = await Promise.all([
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
    const sum = (rows) => (rows ?? []).reduce((s, r) => s + Number(r.total_amount), 0);
    // ── Conversion rate ──
    const conversionRate = allOrders.count && allOrders.count > 0
        ? Math.round(((paidOrders.count ?? 0) / allOrders.count) * 100)
        : 0;
    // ── Role breakdown ──
    const roleCount = {};
    for (const u of usersByRole.data ?? []) {
        const role = u.role;
        roleCount[role] = (roleCount[role] ?? 0) + 1;
    }
    // ── Payment method breakdown ──
    const methodTotals = {};
    for (const p of paymentsRaw.data ?? []) {
        const method = p.payment_method ?? 'unknown';
        const label = method === 'mobile_money' ? 'M-Pesa' : method === 'card' ? 'Card' : 'Other';
        if (!methodTotals[label])
            methodTotals[label] = { count: 0, revenue: 0 };
        methodTotals[label].count++;
        methodTotals[label].revenue += Number(p.amount);
    }
    const paymentMethods = Object.entries(methodTotals).map(([method, v]) => ({ method, ...v }));
    // ── Category revenue ──
    const catRevMap = {};
    for (const item of categoryRevenue.data ?? []) {
        const p = item;
        const cat = p.products?.categories?.name ?? 'Uncategorised';
        catRevMap[cat] = (catRevMap[cat] ?? 0) + Number(p.unit_price) * Number(p.quantity);
    }
    const revenueByCategory = Object.entries(catRevMap)
        .map(([category, revenue]) => ({ category, revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);
    // ── Top customers ──
    const custMap = {};
    for (const o of topCustomers.data ?? []) {
        const uid = o.user_id;
        custMap[uid] = (custMap[uid] ?? 0) + Number(o.total_amount);
    }
    const topCustomerIds = Object.entries(custMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    // Fetch names for top customer ids
    let topCustomerRows = [];
    if (topCustomerIds.length > 0) {
        const { data: profiles } = await supabaseAdmin
            .from('user_profiles')
            .select('id, first_name, last_name')
            .in('id', topCustomerIds.map(([id]) => id));
        const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
        topCustomerRows = topCustomerIds.map(([id, spend]) => {
            const prof = profileMap.get(id);
            return {
                id,
                name: prof ? `${prof.first_name} ${prof.last_name}`.trim() : 'Unknown',
                totalSpend: spend,
            };
        });
    }
    // ── Daily revenue (90d) ──
    const dailyMap = {};
    for (const o of daily90.data ?? []) {
        const date = (o.placed_at).slice(0, 10);
        dailyMap[date] = (dailyMap[date] ?? 0) + Number(o.total_amount);
    }
    const dailyRevenue = Object.entries(dailyMap)
        .map(([date, revenue]) => ({ date, revenue }))
        .sort((a, b) => a.date.localeCompare(b.date));
    // ── Weekly new users ──
    const weekMap = {};
    for (const u of weeklyUsers.data ?? []) {
        const d = new Date(u.created_at);
        // ISO week start (Monday)
        const mon = new Date(d);
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
            allTime: sum(allTimeRevenue.data),
            last7d: sum(revenue7d.data),
            last30d: sum(revenue30d.data),
            last90d: sum(revenue90d.data),
        },
        orders: {
            total: allOrders.count ?? 0,
            paid: paidOrders.count ?? 0,
            failedPayments: failedPayments.count ?? 0,
            conversionRate,
        },
        users: {
            total: allUsers.count ?? 0,
            newLast7d: newUsers7d.count ?? 0,
            newLast30d: newUsers30d.count ?? 0,
            byRole: roleCount,
        },
        paymentMethods,
        revenueByCategory,
        topCustomers: topCustomerRows,
        dailyRevenue,
        weeklyNewUsers,
    };
}
// ─── Super admin delete (can delete admin-role users) ─────────────────────────
export async function superadminDeleteUser(actorId, actorEmail, targetId) {
    if (actorId === targetId)
        throw new ForbiddenError('Cannot delete your own account');
    const { data: target } = await supabaseAdmin
        .from('user_profiles')
        .select('role, first_name, last_name')
        .eq('id', targetId)
        .single();
    if (!target)
        throw new NotFoundError('User');
    const t = target;
    if (t.role === 'superadmin')
        throw new ForbiddenError('Cannot delete another superadmin');
    const { error } = await supabaseAdmin.auth.admin.deleteUser(targetId);
    if (error)
        throw new BadRequestError(error.message);
    logAudit({
        actorId,
        actorEmail,
        actorRole: 'superadmin',
        action: 'user.deleted',
        resourceType: 'user',
        resourceId: targetId,
        details: { deletedRole: t.role, deletedName: `${t.first_name} ${t.last_name}` },
    });
}
