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
    .select('*, products(id, name, slug, sku, status, stock_warning_threshold), product_variants(id, name, options)')
    .lte('available_stock', threshold ?? 10)
    .order('available_stock');
  return data ?? [];
}

export async function adjustStock(productId: string, variantId: string | null, qty: number, reason?: string) {
  const { data: existing } = await supabaseAdmin
    .from('inventory')
    .select('id, total_stock')
    .eq('product_id', productId)
    .is('variant_id', variantId)
    .maybeSingle();

  let newStock: number;
  let result: unknown;

  if (existing) {
    newStock = Math.max(0, (existing.total_stock as number) + qty);
    const { data, error } = await supabaseAdmin
      .from('inventory')
      .update({ total_stock: newStock, last_restocked: qty > 0 ? new Date().toISOString() : undefined })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);
    result = data;
  } else {
    newStock = Math.max(0, qty);
    const { data, error } = await supabaseAdmin
      .from('inventory')
      .insert({ product_id: productId, variant_id: variantId, total_stock: newStock })
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);
    result = data;
  }

  // Keep product_variants.stock_quantity in sync
  if (variantId) {
    await supabaseAdmin
      .from('product_variants')
      .update({ stock_quantity: newStock })
      .eq('id', variantId);
  }

  return result;
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

  // Keep product_variants.stock_quantity in sync
  if (variantId) {
    await supabaseAdmin
      .from('product_variants')
      .update({ stock_quantity: totalStock })
      .eq('id', variantId);
  }

  return data;
}

export async function listAllInventory(_query: { page?: string; limit?: string }) {
  // Fetch all non-archived products with their variants
  const { data: products } = await supabaseAdmin
    .from('products')
    .select('id, name, sku, status, stock_warning_threshold, product_variants(id, name, options, stock_quantity)')
    .neq('status', 'archived')
    .order('name');

  // Fetch all existing inventory rows
  const { data: invRows } = await supabaseAdmin
    .from('inventory')
    .select('product_id, variant_id, available_stock, total_stock, reserved_stock, reorder_point');

  type InvRow = { product_id: string; variant_id: string | null; available_stock: number; total_stock: number; reserved_stock: number; reorder_point: number | null };
  type PVariant = { id: string; name: string; options: Record<string, string>; stock_quantity: number | null };

  const invMap = new Map<string, InvRow>();
  for (const row of invRows ?? []) {
    invMap.set(`${row.product_id}:${row.variant_id ?? ''}`, row as InvRow);
  }

  const result = [];

  for (const p of products ?? []) {
    const variants = (p.product_variants ?? []) as PVariant[];

    if (variants.length === 0) {
      // Base product stock (no variants)
      const inv = invMap.get(`${p.id}:`);
      result.push({
        product_id:       p.id,
        variant_id:       null,
        available_stock:  inv?.available_stock ?? 0,
        total_stock:      inv?.total_stock ?? 0,
        reserved_stock:   inv?.reserved_stock ?? 0,
        reorder_point:    inv?.reorder_point ?? null,
        products:         { name: p.name, sku: p.sku, status: p.status, stock_warning_threshold: p.stock_warning_threshold },
        product_variants: null,
      });
    } else {
      for (const v of variants) {
        const inv = invMap.get(`${p.id}:${v.id}`);
        result.push({
          product_id:       p.id,
          variant_id:       v.id,
          available_stock:  inv?.available_stock ?? v.stock_quantity ?? 0,
          total_stock:      inv?.total_stock ?? v.stock_quantity ?? 0,
          reserved_stock:   inv?.reserved_stock ?? 0,
          reorder_point:    inv?.reorder_point ?? null,
          products:         { name: p.name, sku: p.sku, status: p.status, stock_warning_threshold: p.stock_warning_threshold },
          product_variants: { id: v.id, name: v.name, options: v.options },
        });
      }
    }
  }

  return { data: result, meta: { total: result.length } };
}
