import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export async function getInventory(productId: string, variantId?: string) {
  let q = supabaseAdmin
    .from('inventory')
    .select('*')
    .eq('product_id', productId);
  if (variantId) q = q.eq('variant_id', variantId);
  else q = q.is('variant_id', null);
  const { data } = await q.maybeSingle();
  return data;
}

export async function listLowStock(threshold?: number) {
  const { data } = await supabaseAdmin
    .from('inventory')
    .select('*, products(id, name, slug, sku, status)')
    .lte('available_stock', threshold ?? 10)
    .gt('available_stock', 0)
    .order('available_stock');
  return data ?? [];
}

export async function adjustStock(productId: string, variantId: string | null, qty: number, reason?: string) {
  // Upsert inventory row
  const { data: existing } = await supabaseAdmin
    .from('inventory')
    .select('id, total_stock')
    .eq('product_id', productId)
    .is('variant_id', variantId)
    .maybeSingle();

  if (existing) {
    const newStock = Math.max(0, (existing.total_stock as number) + qty);
    const { data, error } = await supabaseAdmin
      .from('inventory')
      .update({ total_stock: newStock, last_restocked: qty > 0 ? new Date().toISOString() : undefined })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from('inventory')
    .insert({ product_id: productId, variant_id: variantId, total_stock: Math.max(0, qty) })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
}

export async function setStock(productId: string, variantId: string | null, totalStock: number, reorderPoint?: number) {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .upsert({
      product_id:    productId,
      variant_id:    variantId,
      total_stock:   totalStock,
      ...(reorderPoint !== undefined && { reorder_point: reorderPoint }),
      last_restocked: new Date().toISOString(),
    }, { onConflict: 'product_id,variant_id' })
    .select()
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Stock update failed');
  return data;
}

export async function listAllInventory(query: { page?: string; limit?: string }) {
  const limit  = Math.min(100, Number(query.limit) || 20);
  const offset = (Math.max(1, Number(query.page) || 1) - 1) * limit;
  const { data, count } = await supabaseAdmin
    .from('inventory')
    .select('*, products(id, name, slug, sku, status)', { count: 'exact' })
    .order('available_stock')
    .range(offset, offset + limit - 1);
  return { data: data ?? [], meta: { total: count ?? 0 } };
}
