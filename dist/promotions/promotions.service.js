import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
function toDTO(raw) {
    return {
        id: raw.id,
        type: raw.type,
        title: raw.title,
        subtitle: raw.subtitle ?? undefined,
        eyebrow: raw.eyebrow ?? undefined,
        imageUrl: raw.image_url ?? undefined,
        offerText: raw.offer_text ?? undefined,
        offerBg: raw.offer_bg ?? undefined,
        ctaText: raw.cta_text,
        ctaUrl: raw.cta_url,
        bgColor: raw.bg_color ?? undefined,
        tags: raw.tags ?? [],
        offerBadgeStyle: raw.offer_badge_style ?? undefined,
        ctaStyle: raw.cta_style ?? undefined,
        displayOrder: raw.display_order,
        isActive: raw.is_active,
        startsAt: raw.starts_at ?? undefined,
        endsAt: raw.ends_at ?? undefined,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
    };
}
export async function listActivePromotions(type) {
    const now = new Date().toISOString();
    let q = supabaseAdmin
        .from('promotions')
        .select('*')
        .eq('is_active', true)
        .or(`starts_at.is.null,starts_at.lte.${now}`)
        .or(`ends_at.is.null,ends_at.gte.${now}`)
        .order('display_order');
    if (type)
        q = q.eq('type', type);
    const { data, error } = await q;
    if (error)
        throw new BadRequestError(error.message);
    return (data ?? []).map((r) => toDTO(r));
}
export async function listAllPromotions() {
    const { data, error } = await supabaseAdmin
        .from('promotions')
        .select('*')
        .order('type')
        .order('display_order');
    if (error)
        throw new BadRequestError(error.message);
    return (data ?? []).map((r) => toDTO(r));
}
export async function createPromotion(payload) {
    const { data, error } = await supabaseAdmin
        .from('promotions')
        .insert({
        type: payload.type,
        title: payload.title,
        subtitle: payload.subtitle,
        eyebrow: payload.eyebrow,
        image_url: payload.imageUrl,
        offer_text: payload.offerText,
        offer_bg: payload.offerBg,
        cta_text: payload.ctaText ?? 'Shop Now',
        cta_url: payload.ctaUrl,
        bg_color: payload.bgColor,
        tags: payload.tags ?? [],
        offer_badge_style: payload.offerBadgeStyle,
        cta_style: payload.ctaStyle,
        display_order: payload.displayOrder ?? 0,
        is_active: payload.isActive ?? true,
        starts_at: payload.startsAt ?? null,
        ends_at: payload.endsAt ?? null,
    })
        .select()
        .single();
    if (error || !data)
        throw new BadRequestError(error?.message ?? 'Create failed');
    return toDTO(data);
}
export async function updatePromotion(id, payload) {
    const updates = {};
    if (payload.title !== undefined)
        updates.title = payload.title;
    if (payload.subtitle !== undefined)
        updates.subtitle = payload.subtitle;
    if (payload.eyebrow !== undefined)
        updates.eyebrow = payload.eyebrow;
    if (payload.imageUrl !== undefined)
        updates.image_url = payload.imageUrl;
    if (payload.offerText !== undefined)
        updates.offer_text = payload.offerText;
    if (payload.offerBg !== undefined)
        updates.offer_bg = payload.offerBg;
    if (payload.ctaText !== undefined)
        updates.cta_text = payload.ctaText;
    if (payload.ctaUrl !== undefined)
        updates.cta_url = payload.ctaUrl;
    if (payload.bgColor !== undefined)
        updates.bg_color = payload.bgColor;
    if (payload.tags !== undefined)
        updates.tags = payload.tags;
    if (payload.offerBadgeStyle !== undefined)
        updates.offer_badge_style = payload.offerBadgeStyle;
    if (payload.ctaStyle !== undefined)
        updates.cta_style = payload.ctaStyle;
    if (payload.displayOrder !== undefined)
        updates.display_order = payload.displayOrder;
    if (payload.isActive !== undefined)
        updates.is_active = payload.isActive;
    if (payload.startsAt !== undefined)
        updates.starts_at = payload.startsAt;
    if (payload.endsAt !== undefined)
        updates.ends_at = payload.endsAt;
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('promotions')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error || !data)
        throw new NotFoundError('Promotion');
    return toDTO(data);
}
export async function deletePromotion(id) {
    const { error } = await supabaseAdmin.from('promotions').delete().eq('id', id);
    if (error)
        throw new NotFoundError('Promotion');
}
