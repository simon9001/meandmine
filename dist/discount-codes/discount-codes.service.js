import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
export async function validateDiscountCode(code, userId, orderSubtotal) {
    const { data: dc, error } = await supabaseAdmin
        .from('discount_codes')
        .select('*')
        .eq('code', code.toUpperCase().trim())
        .eq('is_active', true)
        .maybeSingle();
    if (error || !dc)
        throw new BadRequestError('Invalid or expired discount code');
    const now = new Date();
    if (dc.valid_until && new Date(dc.valid_until) < now)
        throw new BadRequestError('Discount code has expired');
    if (dc.valid_from && new Date(dc.valid_from) > now)
        throw new BadRequestError('Discount code is not yet active');
    if (dc.max_uses && dc.current_uses >= dc.max_uses)
        throw new BadRequestError('Discount code has reached its usage limit');
    if (dc.min_order_value > 0 && orderSubtotal < dc.min_order_value) {
        throw new BadRequestError(`Minimum order of KES ${dc.min_order_value} required for this code`);
    }
    const { count: userUses } = await supabaseAdmin
        .from('discount_usage')
        .select('id', { count: 'exact', head: true })
        .eq('discount_id', dc.id)
        .eq('user_id', userId);
    if ((userUses ?? 0) >= (dc.uses_per_user ?? 1)) {
        throw new BadRequestError('You have already used this discount code');
    }
    let discountAmount = 0;
    if (dc.discount_type === 'percentage') {
        discountAmount = orderSubtotal * (Number(dc.discount_value) / 100);
        if (dc.max_discount_amount)
            discountAmount = Math.min(discountAmount, Number(dc.max_discount_amount));
    }
    else if (dc.discount_type === 'fixed_amount') {
        discountAmount = Number(dc.discount_value);
    }
    return {
        id: dc.id,
        code: dc.code,
        discountType: dc.discount_type,
        discountAmount: Math.min(discountAmount, orderSubtotal),
        description: dc.name,
    };
}
export async function listDiscountCodes(query) {
    const { page, limit, offset } = parsePage(query);
    let q = supabaseAdmin
        .from('discount_codes')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (query.active === 'true')
        q = q.eq('is_active', true);
    const { data, count } = await q;
    return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
export async function createDiscountCode(payload) {
    const { data, error } = await supabaseAdmin.from('discount_codes').insert({
        code: payload.code.toUpperCase().trim(),
        name: payload.name,
        description: payload.description,
        discount_type: payload.discountType,
        discount_value: payload.discountValue,
        min_order_value: payload.minOrderValue ?? 0,
        max_discount_amount: payload.maxDiscountAmount,
        max_uses: payload.maxUses,
        uses_per_user: payload.usesPerUser ?? 1,
        is_active: payload.isActive ?? true,
        valid_from: payload.validFrom ?? new Date().toISOString(),
        valid_until: payload.validUntil,
    }).select().single();
    if (error || !data)
        throw new BadRequestError(error?.message ?? 'Create failed');
    return data;
}
export async function updateDiscountCode(id, payload) {
    const updates = {};
    if (payload.name !== undefined)
        updates.name = payload.name;
    if (payload.description !== undefined)
        updates.description = payload.description;
    if (payload.discountValue !== undefined)
        updates.discount_value = payload.discountValue;
    if (payload.minOrderValue !== undefined)
        updates.min_order_value = payload.minOrderValue;
    if (payload.maxDiscountAmount !== undefined)
        updates.max_discount_amount = payload.maxDiscountAmount;
    if (payload.maxUses !== undefined)
        updates.max_uses = payload.maxUses;
    if (payload.isActive !== undefined)
        updates.is_active = payload.isActive;
    if (payload.validFrom !== undefined)
        updates.valid_from = payload.validFrom;
    if (payload.validUntil !== undefined)
        updates.valid_until = payload.validUntil;
    const { data, error } = await supabaseAdmin
        .from('discount_codes').update(updates).eq('id', id).select().single();
    if (error || !data)
        throw new NotFoundError('Discount code');
    return data;
}
