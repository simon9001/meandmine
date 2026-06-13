import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export async function listWishlist(userId: string) {
  const { data } = await supabaseAdmin
    .from('wishlists')
    .select('id, product_id, variant_id, created_at, products(id, name, slug, base_price, sale_price, primary_image_url, status)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function addToWishlist(userId: string, productId: string, variantId?: string) {
  const { data: product } = await supabaseAdmin
    .from('products').select('id, status').eq('id', productId).single();
  if (!product) throw new NotFoundError('Product');

  const { data, error } = await supabaseAdmin
    .from('wishlists')
    .upsert({ user_id: userId, product_id: productId, variant_id: variantId ?? null }, { onConflict: 'user_id,product_id,variant_id' })
    .select().single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Add to wishlist failed');
  return data;
}

export async function removeFromWishlist(userId: string, wishlistItemId: string) {
  const { error } = await supabaseAdmin
    .from('wishlists').delete().eq('id', wishlistItemId).eq('user_id', userId);
  if (error) throw new NotFoundError('Wishlist item');
}

export async function checkInWishlist(userId: string, productId: string) {
  const { data } = await supabaseAdmin
    .from('wishlists').select('id').eq('user_id', userId).eq('product_id', productId).maybeSingle();
  return { inWishlist: !!data, id: (data as { id: string } | null)?.id ?? null };
}
