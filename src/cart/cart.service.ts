import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

async function findCart(userId?: string, sessionId?: string): Promise<{ id: string } | null> {
  if (!userId && !sessionId) return null;
  const base = supabaseAdmin.from('carts').select('id').gt('expires_at', new Date().toISOString());
  const { data } = userId
    ? await base.eq('user_id', userId).maybeSingle()
    : await base.eq('session_id', sessionId!).maybeSingle();
  return (data as { id: string } | null);
}

async function getOrCreateCart(userId?: string, sessionId?: string): Promise<string> {
  if (!userId && !sessionId) throw new BadRequestError('userId or sessionId required');
  const existing = await findCart(userId, sessionId);
  if (existing) return existing.id;

  const { data, error } = await supabaseAdmin.from('carts').insert({
    user_id:    userId ?? null,
    session_id: sessionId ?? null,
  }).select('id').single();
  if (error || !data) throw new BadRequestError('Could not create cart');
  return (data as { id: string }).id;
}

export async function getCart(userId?: string, sessionId?: string) {
  const cart = await findCart(userId, sessionId);
  if (!cart) return { id: null, items: [], subtotal: 0 };

  const { data: items } = await supabaseAdmin
    .from('cart_items')
    .select('id, product_id, variant_id, supply_id, quantity, unit_price, products(id, name, slug, base_price, sale_price, status, product_media!product_id(url, is_primary)), product_variants(id, name, options, additional_price)')
    .eq('cart_id', cart.id);

  // Recompute unit_price from LIVE product data on every cart fetch.
  // This ensures the cart always reflects the current sale price, even for
  // items that were added before the sale was set (stale stored unit_price).
  type RawItem = Record<string, unknown>;
  const enriched = (items ?? []).map((item) => {
    const i       = item as RawItem;
    const prod    = i.products    as { base_price?: number; sale_price?: number | null } | null;
    const variant = i.product_variants as { additional_price?: number } | null;
    if (!prod) return i;

    const base          = Number(prod.base_price ?? 0);
    const sale          = prod.sale_price ? Number(prod.sale_price) : 0;
    const effectiveBase = (sale > 0 && sale < base) ? sale : base;
    const livePrice     = effectiveBase + Number(variant?.additional_price ?? 0);

    return { ...i, unit_price: livePrice };
  });

  const subtotal = enriched.reduce(
    (sum, i) => sum + (i as RawItem & { quantity: number; unit_price: number }).quantity
                    * (i as RawItem & { unit_price: number }).unit_price,
    0,
  );
  return { id: cart.id, items: enriched, subtotal };
}

export async function addToCart(payload: {
  userId?: string; sessionId?: string; userRole?: string;
  productId: string; variantId?: string; supplyId?: string; quantity: number;
}) {
  const cartId = await getOrCreateCart(payload.userId, payload.sessionId);

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('base_price, sale_price, status')
    .eq('id', payload.productId)
    .single();

  const isAdmin = payload.userRole === 'admin' || payload.userRole === 'superadmin';
  if (!product || (!isAdmin && (product as { status: string }).status !== 'active')) {
    throw new NotFoundError('Product');
  }

  const p = product as { sale_price: number | null; base_price: number };
  let unitPrice = (p.sale_price && p.sale_price > 0) ? Number(p.sale_price) : Number(p.base_price);

  if (payload.variantId) {
    const { data: variant } = await supabaseAdmin
      .from('product_variants')
      .select('additional_price, is_active')
      .eq('id', payload.variantId)
      .single();
    if (!variant || !(variant as { is_active: boolean }).is_active) throw new NotFoundError('Variant');
    unitPrice += Number((variant as { additional_price: number }).additional_price ?? 0);
  }

  const { data: existing } = await supabaseAdmin
    .from('cart_items')
    .select('id, quantity')
    .eq('cart_id', cartId)
    .eq('product_id', payload.productId)
    .is('variant_id', payload.variantId ?? null)
    .maybeSingle();

  if (existing) {
    const newQty = (existing as { quantity: number }).quantity + payload.quantity;
    const { data, error } = await supabaseAdmin
      .from('cart_items')
      .update({ quantity: newQty, unit_price: unitPrice })
      .eq('id', (existing as { id: string }).id)
      .select().single();
    if (error) throw new BadRequestError(error.message);
    return data;
  }

  const { data, error } = await supabaseAdmin.from('cart_items').insert({
    cart_id:    cartId,
    product_id: payload.productId,
    variant_id: payload.variantId ?? null,
    supply_id:  payload.supplyId ?? null,
    quantity:   payload.quantity,
    unit_price: unitPrice,
  }).select().single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Add to cart failed');
  return data;
}

export async function updateCartItem(cartItemId: string, userId: string | undefined, sessionId: string | undefined, quantity: number) {
  if (quantity < 1) throw new BadRequestError('Quantity must be at least 1');
  const cart = await findCart(userId, sessionId);
  if (!cart) throw new NotFoundError('Cart');

  const { data, error } = await supabaseAdmin
    .from('cart_items')
    .update({ quantity })
    .eq('id', cartItemId)
    .eq('cart_id', cart.id)
    .select().single();
  if (error || !data) throw new NotFoundError('Cart item');
  return data;
}

export async function removeCartItem(cartItemId: string, userId: string | undefined, sessionId: string | undefined) {
  const cart = await findCart(userId, sessionId);
  if (!cart) throw new NotFoundError('Cart');

  const { error } = await supabaseAdmin
    .from('cart_items').delete().eq('id', cartItemId).eq('cart_id', cart.id);
  if (error) throw new NotFoundError('Cart item');
}

export async function clearCart(userId?: string, sessionId?: string) {
  const cart = await findCart(userId, sessionId);
  if (!cart) return;
  await supabaseAdmin.from('cart_items').delete().eq('cart_id', cart.id);
}

export async function mergeCart(sessionId: string, userId: string) {
  const guestCart = await findCart(undefined, sessionId);
  if (!guestCart) return;

  const userCartId = await getOrCreateCart(userId);

  const { data: guestItems } = await supabaseAdmin
    .from('cart_items')
    .select('product_id, variant_id, supply_id, quantity, unit_price')
    .eq('cart_id', guestCart.id);

  for (const item of guestItems ?? []) {
    const i = item as { product_id: string; variant_id: string | null; supply_id: string | null; quantity: number; unit_price: number };
    const { data: existing } = await supabaseAdmin
      .from('cart_items')
      .select('id, quantity')
      .eq('cart_id', userCartId)
      .eq('product_id', i.product_id)
      .is('variant_id', i.variant_id)
      .maybeSingle();
    const ex = existing as { id: string; quantity: number } | null;
    if (ex) {
      await supabaseAdmin.from('cart_items').update({ quantity: ex.quantity + i.quantity }).eq('id', ex.id);
    } else {
      await supabaseAdmin.from('cart_items').insert({
        cart_id: userCartId, product_id: i.product_id, variant_id: i.variant_id,
        supply_id: i.supply_id, quantity: i.quantity, unit_price: i.unit_price,
      });
    }
  }

  await supabaseAdmin.from('carts').delete().eq('id', guestCart.id);
}
