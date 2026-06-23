import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
export async function listProductReviews(productId, query) {
    const { page, limit, offset } = parsePage(query);
    let q = supabaseAdmin
        .from('reviews')
        .select('id, user_id, rating, title, body, is_verified_purchase, helpful_votes, not_helpful_votes, created_at, user_profiles(first_name, last_name)', { count: 'exact' })
        .eq('product_id', productId)
        .eq('status', 'approved')
        .order('helpful_votes', { ascending: false })
        .range(offset, offset + limit - 1);
    if (query.rating)
        q = q.eq('rating', Number(query.rating));
    const { data, count } = await q;
    return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
export async function createReview(userId, payload) {
    // One review per user per product
    const { data: existing } = await supabaseAdmin
        .from('reviews').select('id').eq('user_id', userId).eq('product_id', payload.productId).maybeSingle();
    if (existing)
        throw new BadRequestError('You have already reviewed this product');
    // Verified purchase check
    let isVerified = false;
    if (payload.orderId) {
        // Query via orders table so user_id and order_id are enforced before checking items
        const { data: order } = await supabaseAdmin
            .from('orders')
            .select('id, order_items!inner(id)')
            .eq('id', payload.orderId)
            .eq('user_id', userId)
            .eq('order_items.product_id', payload.productId)
            .maybeSingle();
        isVerified = !!order;
    }
    else {
        const { data: orderItem } = await supabaseAdmin
            .from('order_items')
            .select('id, orders!inner(user_id, payment_status)')
            .eq('product_id', payload.productId)
            .eq('orders.user_id', userId)
            .eq('orders.payment_status', 'paid')
            .limit(1)
            .maybeSingle();
        isVerified = !!orderItem;
    }
    const { data, error } = await supabaseAdmin.from('reviews').insert({
        user_id: userId,
        product_id: payload.productId,
        rating: payload.rating,
        title: payload.title,
        body: payload.body,
        is_verified_purchase: isVerified,
        status: 'pending',
    }).select().single();
    if (error || !data)
        throw new BadRequestError(error?.message ?? 'Review creation failed');
    return data;
}
export async function voteReview(userId, reviewId, vote) {
    const { data: review } = await supabaseAdmin
        .from('reviews').select('id, user_id').eq('id', reviewId).single();
    if (!review)
        throw new NotFoundError('Review');
    if (review.user_id === userId)
        throw new ForbiddenError('Cannot vote on your own review');
    const isHelpful = vote === 'helpful';
    const { data: existing } = await supabaseAdmin
        .from('review_votes')
        .select('is_helpful')
        .eq('review_id', reviewId)
        .eq('user_id', userId)
        .maybeSingle();
    if (existing) {
        if (existing.is_helpful === isHelpful) {
            // Same vote — remove it (toggle off)
            await supabaseAdmin
                .from('review_votes')
                .delete()
                .eq('review_id', reviewId)
                .eq('user_id', userId);
        }
        else {
            // Different vote — switch it; trigger fn_sync_review_votes handles the counts
            await supabaseAdmin
                .from('review_votes')
                .update({ is_helpful: isHelpful })
                .eq('review_id', reviewId)
                .eq('user_id', userId);
        }
    }
    else {
        // New vote
        await supabaseAdmin
            .from('review_votes')
            .insert({ review_id: reviewId, user_id: userId, is_helpful: isHelpful });
    }
    return { success: true };
}
export async function moderateReview(reviewId, status) {
    const { data, error } = await supabaseAdmin
        .from('reviews')
        .update({ status, moderated_by: null, moderated_at: new Date().toISOString() })
        .eq('id', reviewId)
        .select().single();
    if (error || !data)
        throw new NotFoundError('Review');
    return data;
}
export async function adminListReviews(query) {
    const { page, limit, offset } = parsePage(query);
    let q = supabaseAdmin
        .from('reviews')
        .select('id, user_id, product_id, rating, title, status, is_verified_purchase, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (query.status)
        q = q.eq('status', query.status);
    const { data, count } = await q;
    return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
