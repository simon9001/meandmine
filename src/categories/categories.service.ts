import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ConflictError } from '../utils/errors.js';
import { buildKey, cacheGet, cacheSet, cacheDelPattern } from '../utils/cache.js';

const TTL = { list: 600, slug: 600 }; // 10 min — categories change rarely

export async function listCategories(activeOnly = true) {
  const key = buildKey('categories:all', activeOnly);
  const cached = await cacheGet<unknown[]>(key);
  if (cached) return cached;

  let q = supabaseAdmin
    .from('categories')
    .select('id, parent_id, name, slug, description, image_url, icon_url, display_order, depth_level, is_active')
    .order('display_order');
  if (activeOnly) q = q.eq('is_active', true);
  const { data } = await q;
  const result = data ?? [];

  await cacheSet(key, result, TTL.list);
  return result;
}

export async function getCategoryBySlug(slug: string) {
  const key = buildKey('categories:slug', slug);
  const cached = await cacheGet<unknown>(key);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('slug', slug)
    .single();
  if (error || !data) throw new NotFoundError('Category');

  await cacheSet(key, data, TTL.slug);
  return data;
}

export async function createCategory(payload: {
  parentId?: string; name: string; slug: string;
  description?: string; imageUrl?: string; iconUrl?: string;
  displayOrder?: number; metaTitle?: string; metaDescription?: string;
}) {
  const { data: existing } = await supabaseAdmin
    .from('categories').select('id').eq('slug', payload.slug).maybeSingle();
  if (existing) throw new ConflictError('Category slug already exists');

  let depthLevel = 0;
  const pathIds: string[] = [];
  if (payload.parentId) {
    const { data: parent } = await supabaseAdmin
      .from('categories').select('depth_level, path_ids').eq('id', payload.parentId).single();
    if (!parent) throw new NotFoundError('Parent category');
    depthLevel = (parent.depth_level as number) + 1;
    pathIds.push(...(parent.path_ids as string[]), payload.parentId);
  }

  const { data, error } = await supabaseAdmin.from('categories').insert({
    parent_id:        payload.parentId,
    name:             payload.name,
    slug:             payload.slug,
    description:      payload.description,
    image_url:        payload.imageUrl,
    icon_url:         payload.iconUrl,
    display_order:    payload.displayOrder ?? 0,
    meta_title:       payload.metaTitle,
    meta_description: payload.metaDescription,
    depth_level:      depthLevel,
    path_ids:         pathIds,
  }).select().single();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');
  await cacheDelPattern('maschon:categories:*');
  return data;
}

export async function updateCategory(id: string, payload: Partial<{
  name: string; slug: string; description: string; imageUrl: string;
  iconUrl: string; displayOrder: number; isActive: boolean;
  metaTitle: string; metaDescription: string;
}>) {
  const updates: Record<string, unknown> = {};
  if (payload.name             !== undefined) updates.name             = payload.name;
  if (payload.slug             !== undefined) updates.slug             = payload.slug;
  if (payload.description      !== undefined) updates.description      = payload.description;
  if (payload.imageUrl         !== undefined) updates.image_url        = payload.imageUrl;
  if (payload.iconUrl          !== undefined) updates.icon_url         = payload.iconUrl;
  if (payload.displayOrder     !== undefined) updates.display_order    = payload.displayOrder;
  if (payload.isActive         !== undefined) updates.is_active        = payload.isActive;
  if (payload.metaTitle        !== undefined) updates.meta_title       = payload.metaTitle;
  if (payload.metaDescription  !== undefined) updates.meta_description = payload.metaDescription;

  const { data, error } = await supabaseAdmin
    .from('categories').update(updates).eq('id', id).select().single();
  if (error || !data) throw new NotFoundError('Category');
  await cacheDelPattern('maschon:categories:*');
  return data;
}

export async function deleteCategory(id: string) {
  const { error } = await supabaseAdmin.from('categories').delete().eq('id', id);
  if (error) throw new BadRequestError(error.message);
  await cacheDelPattern('maschon:categories:*');
}
