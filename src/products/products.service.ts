import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ConflictError } from '../utils/errors.js';
import { deleteImage } from '../upload/upload.service.js';
import { logger } from '../config/logger.js';
import { buildKey, cacheGet, cacheSet, cacheDel, cacheDelPattern } from '../utils/cache.js';

const TTL = {
  productList:   120,   // 2 min  — listings refresh quickly
  productSlug:   300,   // 5 min  — detail pages
  categorySlugId: 1800, // 30 min — slug→id mapping almost never changes
};

function extractCloudinaryPublicId(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('/upload/');
    if (parts.length < 2) return null;
    const afterUpload = parts[1].replace(/^v\d+\//, ''); // strip version prefix
    return afterUpload.replace(/\.[^/.]+$/, '');          // strip file extension
  } catch {
    return null;
  }
}
import { parsePage } from '../utils/pagination.js';

export interface ProductFilters {
  page?: string | number;
  limit?: string | number;
  search?: string;
  categoryId?: string;
  categorySlug?: string;
  category?: string;           // frontend alias for categorySlug
  brandId?: string;
  minPrice?: string | number;
  maxPrice?: string | number;
  status?: string;
  featured?: string;
  newArrival?: string;
  sort?: string;               // accepts both frontend aliases and raw DB columns
  order?: 'asc' | 'desc';
}

// Translate frontend-friendly sort values to DB columns + direction
function resolveSortCol(sort?: string, order?: string): { col: string; asc: boolean } {
  switch (sort) {
    case 'price_asc':      return { col: 'base_price',     asc: true  };
    case 'price_desc':     return { col: 'base_price',     asc: false };
    case 'newest':         return { col: 'created_at',     asc: false };
    case 'rating':         return { col: 'average_rating', asc: false };
    case 'popular':        return { col: 'order_count',    asc: false };
    case 'base_price':     return { col: 'base_price',     asc: order === 'asc' };
    case 'created_at':     return { col: 'created_at',     asc: order === 'asc' };
    case 'average_rating': return { col: 'average_rating', asc: order === 'asc' };
    case 'order_count':    return { col: 'order_count',    asc: order === 'asc' };
    default:               return { col: 'created_at',     asc: false };
  }
}

// Transform Supabase snake_case row → camelCase Product DTO for the frontend
function toProductDTO(raw: Record<string, unknown>) {
  const media = (raw.product_media ?? []) as Array<{ url: string; is_primary: boolean }>;
  const primaryMedia = media.find((m) => m.is_primary) ?? media[0];
  return {
    id:                   raw.id,
    name:                 raw.name,
    slug:                 raw.slug,
    shortDescription:     raw.short_description ?? undefined,
    basePrice:            raw.base_price,
    salePrice:            raw.sale_price ?? undefined,
    showSalePrice:        raw.show_sale_price ?? false,
    currency:             raw.currency,
    status:               raw.status,
    primaryImageUrl:      primaryMedia?.url ?? undefined,
    isFeatured:           raw.is_featured   ?? false,
    isNewArrival:         raw.is_new_arrival ?? false,
    isBestSeller:         raw.is_best_seller ?? false,
    averageRating:        raw.average_rating ?? 0,
    reviewCount:          raw.review_count   ?? 0,
    orderCount:           raw.order_count    ?? 0,
    stockWarningThreshold: raw.stock_warning_threshold ?? 5,
    tags:                 raw.tags           ?? [],
    category:             raw.categories     ?? undefined,
    brand:                raw.brands         ?? undefined,
  };
}

export async function listProducts(filters: ProductFilters) {
  const { page, limit, offset } = parsePage(filters);
  const { col: sortCol, asc: ascending } = resolveSortCol(filters.sort, filters.order);

  // Cache key covers every filter dimension
  const key = buildKey('products:list', filters);
  const cached = await cacheGet<{ data: ReturnType<typeof toProductDTO>[]; meta: { total: number; page: number; limit: number } }>(key);
  if (cached) return cached;

  let q = supabaseAdmin
    .from('products')
    .select(
      `id, name, slug, short_description, base_price, sale_price, show_sale_price, currency, status,
       is_featured, is_new_arrival, is_best_seller, average_rating, review_count,
       order_count, stock_warning_threshold, tags, created_at,
       categories(id, name, slug),
       brands(id, name, slug),
       product_media!product_id(url, is_primary)`,
      { count: 'exact' }
    );

  if (filters.status && filters.status !== 'all') {
    q = q.eq('status', filters.status);
  } else if (!filters.status) {
    q = q.eq('status', 'active');
  }

  if (filters.search)     q = q.textSearch('search_vector', filters.search, { type: 'websearch' });
  if (filters.categoryId) q = q.eq('category_id', filters.categoryId);
  if (filters.brandId)    q = q.eq('brand_id', filters.brandId);
  if (filters.minPrice)   q = q.gte('base_price', Number(filters.minPrice));
  if (filters.maxPrice)   q = q.lte('base_price', Number(filters.maxPrice));
  if (filters.featured   === 'true') q = q.eq('is_featured',   true);
  if (filters.newArrival === 'true') q = q.eq('is_new_arrival', true);

  // Cache the slug→id lookup so repeated category filter requests skip the extra DB round-trip
  const catSlug = filters.categorySlug ?? filters.category;
  if (catSlug) {
    const idKey = buildKey('categories:id', catSlug);
    let catId = await cacheGet<string>(idKey);
    if (!catId) {
      const { data: cat } = await supabaseAdmin
        .from('categories').select('id').eq('slug', catSlug).single();
      if (!cat) return { data: [], meta: { total: 0, page, limit } };
      catId = (cat as { id: string }).id;
      await cacheSet(idKey, catId, TTL.categorySlugId);
    }
    q = q.eq('category_id', catId);
  }

  q = q.order(sortCol, { ascending }).range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) {
    logger.error('[listProducts] Supabase error', { message: error.message, details: error.details, hint: error.hint });
    throw new BadRequestError('Could not fetch products');
  }

  const result = {
    data: (data ?? []).map((row) => toProductDTO(row as Record<string, unknown>)),
    meta: { total: count ?? 0, page, limit },
  };

  // Skip caching search results (too unique to be reused) and admin full-table views
  if (!filters.search && filters.status !== 'all') {
    await cacheSet(key, result, TTL.productList);
  }

  return result;
}

export async function getProductBySlug(slug: string) {
  const key = buildKey('products:slug', slug);
  const cached = await cacheGet<ReturnType<typeof buildProductDetail>>(key);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from('v_product_page')
    .select('*')
    .eq('slug', slug)
    .single();
  if (error || !data) throw new NotFoundError('Product');

  const raw = data as Record<string, unknown>;

  // Fetch all supplementary data in parallel (was 3 sequential round-trips)
  const [mediaRes, variantsRes, badgesRes] = await Promise.all([
    supabaseAdmin
      .from('product_media')
      .select('id, media_type, url, thumbnail_url, alt_text, display_order, is_primary, variant_id')
      .eq('product_id', raw.id)
      .order('display_order'),
    supabaseAdmin
      .from('product_variants')
      .select('id, sku, name, options, additional_price, stock_quantity, is_active')
      .eq('product_id', raw.id)
      .eq('is_active', true),
    supabaseAdmin
      .from('product_trust_badges')
      .select('badge_id, display_order, trust_badges(name, icon_url, description)')
      .eq('product_id', raw.id)
      .order('display_order'),
  ]);

  const result = buildProductDetail(raw, mediaRes.data ?? [], variantsRes.data, badgesRes.data);
  await cacheSet(key, result, TTL.productSlug);
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProductDetail(raw: Record<string, unknown>, mediaList: any[], variants: any[] | null, badges: any[] | null) {
  const primaryMedia = mediaList.find((m: { is_primary: boolean }) => m.is_primary) ?? mediaList[0];
  return {
    id:                    raw.id,
    name:                  raw.name,
    slug:                  raw.slug,
    shortDescription:      raw.short_description ?? undefined,
    fullDescription:       raw.full_description  ?? undefined,
    basePrice:             Number(raw.base_price  ?? raw.base_price_num ?? 0),
    salePrice:             raw.sale_price != null ? Number(raw.sale_price) : undefined,
    showSalePrice:         raw.show_sale_price    ?? false,
    currency:              raw.currency            ?? 'KES',
    status:                raw.status,
    primaryImageUrl:       (primaryMedia?.url as string | undefined) ?? raw.primary_image_url ?? undefined,
    isFeatured:            raw.is_featured         ?? false,
    isNewArrival:          raw.is_new_arrival      ?? false,
    isBestSeller:          raw.is_best_seller      ?? false,
    averageRating:         Number(raw.average_rating ?? 0),
    reviewCount:           Number(raw.review_count   ?? 0),
    orderCount:            Number(raw.order_count    ?? 0),
    stockWarningThreshold: Number(raw.stock_warning_threshold ?? 5),
    tags:                  raw.tags  ?? [],
    category: (() => {
      const nested = raw.categories as { id: string; name: string; slug: string } | null;
      if (nested?.id) return { id: nested.id, name: nested.name, slug: nested.slug };
      if (raw.category_id) return {
        id:   raw.category_id as string,
        name: (raw.category_name ?? '') as string,
        slug: (raw.category_slug ?? '') as string,
      };
      return undefined;
    })(),
    media: mediaList.map((m) => ({
      id:           m.id as string,
      url:          m.url as string,
      thumbnailUrl: (m.thumbnail_url ?? undefined) as string | undefined,
      altText:      (m.alt_text      ?? undefined) as string | undefined,
      mediaType:    m.media_type as string,
      isPrimary:    m.is_primary as boolean,
      displayOrder: m.display_order as number,
      variantId:    (m.variant_id ?? undefined) as string | undefined,
    })),
    variants: (variants ?? []).map((v) => ({
      id:              v.id as string,
      name:            v.name as string,
      options:         v.options as Record<string, string>,
      additionalPrice: Number(v.additional_price ?? 0),
      isActive:        v.is_active as boolean,
      sku:             (v.sku ?? undefined) as string | undefined,
    })),
    trustBadges: (badges ?? []).map((b) => ({
      id:          b.badge_id as string,
      title:       (b.trust_badges as { name: string } | null)?.name ?? '',
      description: (b.trust_badges as { description?: string } | null)?.description,
      iconUrl:     (b.trust_badges as { icon_url?: string } | null)?.icon_url,
    })),
  };
}

export async function getProductById(id: string) {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) throw new NotFoundError('Product');
  return data;
}

export async function createProduct(payload: {
  categoryId?: string; brandId?: string; name: string; slug: string; sku?: string;
  shortDescription?: string; fullDescription?: string;
  basePrice: number; salePrice?: number; costPrice?: number; currency?: string;
  status?: string; isFeatured?: boolean; isNewArrival?: boolean; showSalePrice?: boolean;
  metaTitle?: string; metaDescription?: string; metaKeywords?: string[];
  stockWarningThreshold?: number; weightGrams?: number; dimensionsCm?: Record<string, number>;
  attributes?: Record<string, unknown>; tags?: string[];
}) {
  const { data: existing } = await supabaseAdmin
    .from('products').select('id').eq('slug', payload.slug).maybeSingle();
  if (existing) throw new ConflictError('Product slug already exists');

  const { data, error } = await supabaseAdmin.from('products').insert({
    category_id:              payload.categoryId,
    brand_id:                 payload.brandId,
    name:                     payload.name,
    slug:                     payload.slug,
    sku:                      payload.sku,
    short_description:        payload.shortDescription,
    full_description:         payload.fullDescription,
    base_price:               payload.basePrice,
    sale_price:               payload.salePrice,
    cost_price:               payload.costPrice,
    currency:                 payload.currency ?? 'KES',
    status:                   payload.status ?? 'draft',
    is_featured:              payload.isFeatured   ?? false,
    is_new_arrival:           payload.isNewArrival ?? false,
    is_best_seller:           false,
    show_sale_price:          payload.showSalePrice ?? false,
    meta_title:               payload.metaTitle,
    meta_description:         payload.metaDescription,
    meta_keywords:            payload.metaKeywords,
    stock_warning_threshold:  payload.stockWarningThreshold ?? 5,
    weight_grams:             payload.weightGrams,
    dimensions_cm:            payload.dimensionsCm,
    attributes:               payload.attributes ?? {},
    tags:                     payload.tags ?? [],
    published_at:             payload.status === 'active' ? new Date().toISOString() : null,
  }).select().single();

  if (error || !data) {
    logger.error('[createProduct] Supabase error', { message: error?.message, details: error?.details, hint: error?.hint });
    throw new BadRequestError(error?.message ?? 'Create failed');
  }
  await cacheDelPattern('maschon:products:list:*');
  return data;
}

export async function updateProduct(id: string, payload: Partial<{
  categoryId: string; brandId: string; name: string; slug: string; sku: string;
  shortDescription: string; fullDescription: string;
  basePrice: number; salePrice: number | null; costPrice: number;
  status: string; isFeatured: boolean; isNewArrival: boolean; isBestSeller: boolean; showSalePrice: boolean;
  metaTitle: string; metaDescription: string; metaKeywords: string[];
  stockWarningThreshold: number; weightGrams: number; attributes: Record<string, unknown>;
  tags: string[];
}>) {
  const updates: Record<string, unknown> = {};
  if (payload.categoryId            !== undefined) updates.category_id             = payload.categoryId;
  if (payload.brandId               !== undefined) updates.brand_id                = payload.brandId;
  if (payload.name                  !== undefined) updates.name                    = payload.name;
  if (payload.slug                  !== undefined) updates.slug                    = payload.slug;
  if (payload.sku                   !== undefined) updates.sku                     = payload.sku;
  if (payload.shortDescription      !== undefined) updates.short_description       = payload.shortDescription;
  if (payload.fullDescription       !== undefined) updates.full_description        = payload.fullDescription;
  if (payload.basePrice             !== undefined) updates.base_price              = payload.basePrice;
  if (payload.salePrice             !== undefined) updates.sale_price              = payload.salePrice;
  if (payload.costPrice             !== undefined) updates.cost_price              = payload.costPrice;
  if (payload.status                !== undefined) {
    updates.status = payload.status;
    if (payload.status === 'active') updates.published_at = new Date().toISOString();
  }
  if (payload.isFeatured            !== undefined) updates.is_featured             = payload.isFeatured;
  if (payload.isNewArrival          !== undefined) updates.is_new_arrival          = payload.isNewArrival;
  if (payload.isBestSeller          !== undefined) updates.is_best_seller          = payload.isBestSeller;
  if (payload.showSalePrice         !== undefined) updates.show_sale_price         = payload.showSalePrice;
  if (payload.metaTitle             !== undefined) updates.meta_title              = payload.metaTitle;
  if (payload.metaDescription       !== undefined) updates.meta_description        = payload.metaDescription;
  if (payload.metaKeywords          !== undefined) updates.meta_keywords           = payload.metaKeywords;
  if (payload.stockWarningThreshold !== undefined) updates.stock_warning_threshold = payload.stockWarningThreshold;
  if (payload.weightGrams           !== undefined) updates.weight_grams            = payload.weightGrams;
  if (payload.attributes            !== undefined) updates.attributes              = payload.attributes;
  if (payload.tags                  !== undefined) updates.tags                    = payload.tags;

  const { data, error } = await supabaseAdmin
    .from('products').update(updates).eq('id', id).select().single();
  if (error || !data) throw new NotFoundError('Product');

  // Invalidate both the list cache and any slug-specific cache for this product
  const row = data as { slug?: string };
  await Promise.all([
    cacheDelPattern('maschon:products:list:*'),
    row.slug ? cacheDel(buildKey('products:slug', row.slug)) : Promise.resolve(),
  ]);
  return data;
}

export async function deleteProduct(id: string) {
  // Clean up all product images from Cloudinary before archiving
  const { data: mediaRows } = await supabaseAdmin
    .from('product_media').select('url').eq('product_id', id);
  if (mediaRows?.length) {
    await Promise.allSettled(
      mediaRows.map((m) => {
        const pid = extractCloudinaryPublicId(m.url);
        return pid ? deleteImage(pid) : Promise.resolve();
      })
    );
  }

  const { data: productRow } = await supabaseAdmin
    .from('products').select('slug').eq('id', id).single();

  const { error } = await supabaseAdmin
    .from('products').update({ status: 'archived' }).eq('id', id);
  if (error) throw new NotFoundError('Product');

  const slug = (productRow as { slug?: string } | null)?.slug;
  await Promise.all([
    cacheDelPattern('maschon:products:list:*'),
    slug ? cacheDel(buildKey('products:slug', slug)) : Promise.resolve(),
  ]);
}

// ─── Product media ─────────────────────────────────────────────────────────────

export async function addProductMedia(productId: string, payload: {
  mediaType?: string; url: string; thumbnailUrl?: string;
  altText?: string; displayOrder?: number; isPrimary?: boolean; variantId?: string;
}) {
  if (payload.isPrimary) {
    await supabaseAdmin.from('product_media').update({ is_primary: false }).eq('product_id', productId);
  }
  const { data, error } = await supabaseAdmin.from('product_media').insert({
    product_id:    productId,
    media_type:    payload.mediaType ?? 'image',
    url:           payload.url,
    thumbnail_url: payload.thumbnailUrl,
    alt_text:      payload.altText,
    display_order: payload.displayOrder ?? 0,
    is_primary:    payload.isPrimary ?? false,
    variant_id:    payload.variantId ?? null,
  }).select().single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Media add failed');

  // Invalidate product detail so updated images are visible immediately
  const { data: p } = await supabaseAdmin.from('products').select('slug').eq('id', productId).single();
  const slug = (p as { slug?: string } | null)?.slug;
  if (slug) await cacheDel(buildKey('products:slug', slug));

  return data;
}

export async function deleteProductMedia(productId: string, mediaId: string) {
  // Fetch URL first so we can clean up Cloudinary
  const { data: row } = await supabaseAdmin
    .from('product_media').select('url').eq('id', mediaId).eq('product_id', productId).single();

  const { error } = await supabaseAdmin
    .from('product_media').delete().eq('id', mediaId).eq('product_id', productId);
  if (error) throw new NotFoundError('Media');

  if (row) {
    const pid = extractCloudinaryPublicId(row.url);
    if (pid) await deleteImage(pid).catch(() => {});
  }

  const { data: p } = await supabaseAdmin.from('products').select('slug').eq('id', productId).single();
  const slug = (p as { slug?: string } | null)?.slug;
  if (slug) await cacheDel(buildKey('products:slug', slug));
}

// ─── Supplier comparison (product page) ───────────────────────────────────────

export async function getSupplierComparison(productId: string) {
  const { data } = await supabaseAdmin
    .from('v_supplier_comparison')
    .select('*')
    .eq('product_id', productId);
  return data ?? [];
}

// ─── Product variants ──────────────────────────────────────────────────────────

export async function createProductVariant(productId: string, payload: {
  name: string; sku?: string; options: Record<string, string>;
  additionalPrice?: number; stockQuantity?: number;
}) {
  const { data, error } = await supabaseAdmin.from('product_variants').insert({
    product_id:       productId,
    name:             payload.name,
    sku:              payload.sku ?? null,
    options:          payload.options,
    additional_price: payload.additionalPrice ?? 0,
    stock_quantity:   payload.stockQuantity ?? 0,
    is_active:        true,
  }).select('id, name, options, additional_price').single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Create variant failed');

  const v = data as { id: string; name: string; options: Record<string, string>; additional_price: number };
  // Invalidate product cache so the new variant shows up immediately
  const { data: p } = await supabaseAdmin.from('products').select('slug').eq('id', productId).single();
  const slug = (p as { slug?: string } | null)?.slug;
  if (slug) await cacheDel(buildKey('products:slug', slug));

  return { id: v.id, name: v.name, options: v.options, additionalPrice: Number(v.additional_price) };
}

export async function deleteProductVariant(productId: string, variantId: string) {
  const { error } = await supabaseAdmin
    .from('product_variants').delete().eq('id', variantId).eq('product_id', productId);
  if (error) throw new NotFoundError('Variant');

  const { data: p } = await supabaseAdmin.from('products').select('slug').eq('id', productId).single();
  const slug = (p as { slug?: string } | null)?.slug;
  if (slug) await cacheDel(buildKey('products:slug', slug));
}

// ─── Increment view count ──────────────────────────────────────────────────────

export async function incrementViewCount(productId: string) {
  await supabaseAdmin.rpc('increment_product_views' as never, { p_product_id: productId });
}
