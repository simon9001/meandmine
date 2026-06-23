import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
export async function listSuppliers(query) {
    const { page, limit, offset } = parsePage(query);
    let q = supabaseAdmin
        .from('suppliers')
        .select('id, name, slug, email, phone, country_code, city, rating, is_verified, is_active, created_at', { count: 'exact' })
        .order('name')
        .range(offset, offset + limit - 1);
    if (query.active !== 'false')
        q = q.eq('is_active', true);
    const { data, count } = await q;
    return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
export async function getSupplierById(id) {
    const { data, error } = await supabaseAdmin
        .from('suppliers').select('*').eq('id', id).single();
    if (error || !data)
        throw new NotFoundError('Supplier');
    return data;
}
export async function createSupplier(payload) {
    const { data, error } = await supabaseAdmin.from('suppliers').insert({
        name: payload.name,
        slug: payload.slug,
        email: payload.email,
        phone: payload.phone,
        website_url: payload.websiteUrl,
        country_code: payload.countryCode,
        city: payload.city,
        address: payload.address,
        contact_person: payload.contactPerson,
        notes: payload.notes,
        metadata: payload.metadata ?? {},
    }).select().single();
    if (error || !data)
        throw new BadRequestError(error?.message ?? 'Create failed');
    return data;
}
export async function updateSupplier(id, payload) {
    const updates = {};
    if (payload.name !== undefined)
        updates.name = payload.name;
    if (payload.email !== undefined)
        updates.email = payload.email;
    if (payload.phone !== undefined)
        updates.phone = payload.phone;
    if (payload.websiteUrl !== undefined)
        updates.website_url = payload.websiteUrl;
    if (payload.countryCode !== undefined)
        updates.country_code = payload.countryCode;
    if (payload.city !== undefined)
        updates.city = payload.city;
    if (payload.address !== undefined)
        updates.address = payload.address;
    if (payload.contactPerson !== undefined)
        updates.contact_person = payload.contactPerson;
    if (payload.rating !== undefined)
        updates.rating = payload.rating;
    if (payload.isVerified !== undefined)
        updates.is_verified = payload.isVerified;
    if (payload.isActive !== undefined)
        updates.is_active = payload.isActive;
    if (payload.notes !== undefined)
        updates.notes = payload.notes;
    const { data, error } = await supabaseAdmin
        .from('suppliers').update(updates).eq('id', id).select().single();
    if (error || !data)
        throw new NotFoundError('Supplier');
    return data;
}
// ─── Product supply (per-product-supplier pricing) ────────────────────────────
export async function listProductSupply(productId) {
    const { data } = await supabaseAdmin
        .from('product_supply')
        .select('*, suppliers(id, name, slug, rating, is_verified, lead_time_days)')
        .eq('product_id', productId)
        .eq('status', 'active')
        .order('supplier_price');
    return data ?? [];
}
export async function upsertProductSupply(payload) {
    const { data, error } = await supabaseAdmin.from('product_supply').upsert({
        product_id: payload.productId,
        supplier_id: payload.supplierId,
        variant_id: payload.variantId,
        supplier_sku: payload.supplierSku,
        supplier_price: payload.supplierPrice,
        currency: payload.currency ?? 'KES',
        min_order_qty: payload.minOrderQty ?? 1,
        lead_time_days: payload.leadTimeDays,
        stock_quantity: payload.stockQuantity ?? 0,
        status: payload.status ?? 'active',
        is_preferred: payload.isPreferred ?? false,
        notes: payload.notes,
    }, { onConflict: 'product_id,supplier_id,variant_id' }).select().single();
    if (error || !data)
        throw new BadRequestError(error?.message ?? 'Upsert failed');
    return data;
}
export async function getPricingHistory(productId, supplierId) {
    let q = supabaseAdmin
        .from('pricing_history')
        .select('id, old_price, new_price, currency, reason, recorded_at, suppliers(name)')
        .eq('product_id', productId)
        .order('recorded_at', { ascending: false })
        .limit(50);
    if (supplierId)
        q = q.eq('supplier_id', supplierId);
    const { data } = await q;
    return data ?? [];
}
