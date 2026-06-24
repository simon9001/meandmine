import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import { logAudit } from '../superadmin/audit.js';
export async function getProfile(userId) {
    const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('id, first_name, last_name, phone, phone_verified, avatar_url, preferred_currency, preferred_language, notification_prefs, is_active, last_login_at, created_at')
        .eq('id', userId)
        .single();
    if (error || !data)
        throw new NotFoundError('User');
    return {
        id: data.id,
        firstName: data.first_name,
        lastName: data.last_name,
        phone: data.phone,
        phoneVerified: data.phone_verified,
        avatarUrl: data.avatar_url ?? null,
        preferredCurrency: data.preferred_currency,
        preferredLanguage: data.preferred_language,
        notificationPrefs: data.notification_prefs,
        isActive: data.is_active,
        lastLoginAt: data.last_login_at,
        createdAt: data.created_at,
    };
}
export async function updateProfile(userId, payload) {
    const updates = {};
    if (payload.firstName !== undefined)
        updates.first_name = payload.firstName;
    if (payload.lastName !== undefined)
        updates.last_name = payload.lastName;
    if (payload.phone !== undefined)
        updates.phone = payload.phone;
    if (payload.preferredCurrency !== undefined)
        updates.preferred_currency = payload.preferredCurrency;
    if (payload.preferredLanguage !== undefined)
        updates.preferred_language = payload.preferredLanguage;
    if (payload.notificationPrefs !== undefined)
        updates.notification_prefs = payload.notificationPrefs;
    const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
    if (error || !data)
        throw new BadRequestError(error?.message ?? 'Update failed');
    return {
        id: data.id,
        firstName: data.first_name,
        lastName: data.last_name,
        phone: data.phone,
        avatarUrl: data.avatar_url ?? null,
    };
}
export async function updateAvatar(userId, avatarUrl) {
    const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', userId)
        .select('avatar_url')
        .single();
    if (error)
        throw new BadRequestError(error.message);
    return data;
}
// ─── Addresses ────────────────────────────────────────────────────────────────
export async function listAddresses(userId) {
    const { data } = await supabaseAdmin
        .from('addresses')
        .select('*')
        .eq('user_id', userId)
        .order('is_default', { ascending: false });
    return data ?? [];
}
export async function createAddress(userId, payload) {
    if (payload.isDefault) {
        await supabaseAdmin.from('addresses').update({ is_default: false }).eq('user_id', userId);
    }
    const { data, error } = await supabaseAdmin
        .from('addresses')
        .insert({
        user_id: userId,
        label: payload.label ?? 'Home',
        recipient_name: payload.recipientName,
        phone: payload.phone,
        address_line1: payload.addressLine1,
        address_line2: payload.addressLine2,
        city: payload.city,
        county: payload.county,
        postal_code: payload.postalCode,
        country_code: payload.countryCode ?? 'KE',
        is_default: payload.isDefault ?? false,
    })
        .select()
        .single();
    if (error || !data)
        throw new BadRequestError(error?.message ?? 'Create failed');
    return data;
}
export async function updateAddress(userId, addressId, payload) {
    if (payload.isDefault) {
        await supabaseAdmin.from('addresses').update({ is_default: false }).eq('user_id', userId);
    }
    const updates = {};
    if (payload.label !== undefined)
        updates.label = payload.label;
    if (payload.recipientName !== undefined)
        updates.recipient_name = payload.recipientName;
    if (payload.phone !== undefined)
        updates.phone = payload.phone;
    if (payload.addressLine1 !== undefined)
        updates.address_line1 = payload.addressLine1;
    if (payload.addressLine2 !== undefined)
        updates.address_line2 = payload.addressLine2;
    if (payload.city !== undefined)
        updates.city = payload.city;
    if (payload.county !== undefined)
        updates.county = payload.county;
    if (payload.postalCode !== undefined)
        updates.postal_code = payload.postalCode;
    if (payload.isDefault !== undefined)
        updates.is_default = payload.isDefault;
    const { data, error } = await supabaseAdmin
        .from('addresses')
        .update(updates)
        .eq('id', addressId)
        .eq('user_id', userId)
        .select()
        .single();
    if (error || !data)
        throw new NotFoundError('Address');
    return data;
}
export async function deleteAddress(userId, addressId) {
    const { error } = await supabaseAdmin
        .from('addresses')
        .delete()
        .eq('id', addressId)
        .eq('user_id', userId);
    if (error)
        throw new NotFoundError('Address');
}
// ─── Admin: list users ────────────────────────────────────────────────────────
export async function listUsers(query) {
    const { page, limit, offset } = parsePage(query);
    let q = supabaseAdmin
        .from('user_profiles')
        .select('id, first_name, last_name, phone, avatar_url, role, is_active, last_login_at, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (query.role)
        q = q.eq('role', query.role);
    if (query.search) {
        const s = `%${query.search}%`;
        q = q.or(`first_name.ilike.${s},last_name.ilike.${s}`);
    }
    const { data: profiles, count } = await q;
    // Fetch emails from auth (up to 1000 — fine for a small store)
    const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const emailMap = new Map();
    for (const u of authData?.users ?? []) {
        emailMap.set(u.id, { email: u.email ?? '', confirmedAt: u.email_confirmed_at ?? null });
    }
    const data = (profiles ?? []).map((p) => {
        const auth = emailMap.get(p.id);
        return {
            id: p.id,
            firstName: p.first_name,
            lastName: p.last_name,
            phone: p.phone ?? null,
            avatarUrl: p.avatar_url ?? null,
            role: p.role,
            isActive: p.is_active,
            lastLoginAt: p.last_login_at,
            createdAt: p.created_at,
            email: auth?.email ?? '',
            isEmailVerified: !!auth?.confirmedAt,
        };
    });
    return { data, meta: { total: count ?? 0, page, limit } };
}
export async function setUserRole(actorId, actorEmail, targetUserId, role) {
    if (actorId === targetUserId)
        throw new ForbiddenError('Cannot change your own role');
    if (role === 'superadmin')
        throw new ForbiddenError('Cannot assign superadmin role');
    const { data: target } = await supabaseAdmin
        .from('user_profiles').select('role').eq('id', targetUserId).single();
    if (target?.role === 'superadmin')
        throw new ForbiddenError('Cannot change the role of a superadmin');
    const previousRole = target?.role;
    const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .update({ role })
        .eq('id', targetUserId)
        .select('id, role')
        .single();
    if (error || !data)
        throw new NotFoundError('User');
    logAudit({
        actorId, actorEmail,
        action: 'user.role_changed',
        resourceType: 'user',
        resourceId: targetUserId,
        details: { from: previousRole, to: role },
    });
    return data;
}
export async function adminUpdateUser(actorId, targetId, payload) {
    if (actorId === targetId && payload.role !== undefined) {
        throw new ForbiddenError('Cannot change your own role');
    }
    if (payload.role === 'superadmin') {
        throw new ForbiddenError('Cannot assign superadmin role');
    }
    const { data: target } = await supabaseAdmin
        .from('user_profiles').select('role').eq('id', targetId).single();
    if (!target)
        throw new NotFoundError('User');
    if (target.role === 'superadmin' && payload.role !== undefined) {
        throw new ForbiddenError('Cannot change the role of a superadmin');
    }
    const updates = {};
    if (payload.firstName !== undefined)
        updates.first_name = payload.firstName;
    if (payload.lastName !== undefined)
        updates.last_name = payload.lastName;
    if (payload.phone !== undefined)
        updates.phone = payload.phone;
    if (payload.isActive !== undefined)
        updates.is_active = payload.isActive;
    if (payload.role !== undefined)
        updates.role = payload.role;
    if (Object.keys(updates).length === 0)
        return { id: targetId };
    const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .update(updates)
        .eq('id', targetId)
        .select('id, first_name, last_name, phone, avatar_url, role, is_active')
        .single();
    if (error || !data)
        throw new BadRequestError(error?.message ?? 'Update failed');
    return data;
}
export async function adminDeleteUser(actorId, actorRole, targetId) {
    if (actorId === targetId)
        throw new ForbiddenError('Cannot delete your own account');
    const { data: target } = await supabaseAdmin
        .from('user_profiles').select('role').eq('id', targetId).single();
    if (!target)
        throw new NotFoundError('User');
    const targetRole = target.role;
    if (targetRole === 'superadmin')
        throw new ForbiddenError('Cannot delete a superadmin');
    // Only superadmin can delete other admins
    if (targetRole === 'admin' && actorRole !== 'superadmin') {
        throw new ForbiddenError('Only a superadmin can delete an admin user');
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(targetId);
    if (error)
        throw new BadRequestError(error.message);
    logAudit({
        actorId, actorRole,
        action: 'user.deleted',
        resourceType: 'user',
        resourceId: targetId,
        details: { deletedRole: targetRole },
    });
}
export async function adminCreateUser(actorId, actorEmail, payload) {
    if (payload.role === 'superadmin')
        throw new ForbiddenError('Cannot assign superadmin role');
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: payload.email,
        password: payload.password,
        email_confirm: true,
        user_metadata: { first_name: payload.firstName, last_name: payload.lastName },
    });
    if (authError || !authData.user)
        throw new BadRequestError(authError?.message ?? 'Failed to create user');
    await supabaseAdmin.from('user_profiles').upsert({
        id: authData.user.id,
        first_name: payload.firstName,
        last_name: payload.lastName,
        role: payload.role,
        phone: payload.phone ?? null,
    }, { onConflict: 'id' });
    logAudit({
        actorId, actorEmail,
        action: 'user.created',
        resourceType: 'user',
        resourceId: authData.user.id,
        details: { email: payload.email, role: payload.role },
    });
    return { id: authData.user.id, email: payload.email };
}
