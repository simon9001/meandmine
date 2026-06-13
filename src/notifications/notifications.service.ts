import { supabaseAdmin } from '../config/db.js';
import { parsePage } from '../utils/pagination.js';

export async function listNotifications(userId: string, query: { page?: string; limit?: string; unread?: string }) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('notifications')
    .select('id, type, title, body, data, read_at, created_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.unread === 'true') q = q.is('read_at', null);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function markRead(userId: string, notificationIds: string[]) {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', notificationIds)
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

export async function markAllRead(userId: string) {
  await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
}

export async function getUnreadCount(userId: string) {
  const { count } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  return { count: count ?? 0 };
}
