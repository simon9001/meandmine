import type { Context } from 'hono';

export function ok<T>(c: Context, data: T, status: 200 | 201 = 200) {
  return c.json({ success: true, data }, status);
}

export function paginated<T>(
  c: Context,
  data: T[],
  meta: { total: number; page: number; limit: number }
) {
  return c.json({
    success: true,
    data,
    meta: { ...meta, totalPages: Math.ceil(meta.total / meta.limit) },
  });
}

export function noContent(c: Context) {
  return c.body(null, 204);
}
