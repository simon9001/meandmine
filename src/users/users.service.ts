import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

export async function getProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('id, first_name, last_name, phone, phone_verified, avatar_url, preferred_currency, preferred_language, notification_prefs, is_active, last_login_at, created_at')
    .eq('id', userId)
    .single();
  if (error || !data) throw new NotFoundError('User');
  return {
    id:                data.id,
    firstName:         data.first_name,
    lastName:          data.last_name,
    phone:             data.phone,
    phoneVerified:     data.phone_verified,
    avatarUrl:         data.avatar_url ?? null,
    preferredCurrency: data.preferred_currency,
    preferredLanguage: data.preferred_language,
    notificationPrefs: data.notification_prefs,
    isActive:          data.is_active,
    lastLoginAt:       data.last_login_at,
    createdAt:         data.created_at,
  };
}

export async function updateProfile(userId: string, payload: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  preferredCurrency?: string;
  preferredLanguage?: string;
  notificationPrefs?: Record<string, boolean>;
}) {
  const updates: Record<string, unknown> = {};
  if (payload.firstName          !== undefined) updates.first_name         = payload.firstName;
  if (payload.lastName           !== undefined) updates.last_name          = payload.lastName;
  if (payload.phone              !== undefined) updates.phone              = payload.phone;
  if (payload.preferredCurrency  !== undefined) updates.preferred_currency = payload.preferredCurrency;
  if (payload.preferredLanguage  !== undefined) updates.preferred_language = payload.preferredLanguage;
  if (payload.notificationPrefs  !== undefined) updates.notification_prefs = payload.notificationPrefs;

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Update failed');
  return {
    id:        data.id,
    firstName: data.first_name,
    lastName:  data.last_name,
    phone:     data.phone,
    avatarUrl: data.avatar_url ?? null,
  };
}

export async function updateAvatar(userId: string, avatarUrl: string) {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', userId)
    .select('avatar_url')
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
}

// ─── Addresses ────────────────────────────────────────────────────────────────

export async function listAddresses(userId: string) {
  const { data } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });
  return data ?? [];
}

export async function createAddress(userId: string, payload: {
  label?: string; recipientName: string; phone: string;
  addressLine1: string; addressLine2?: string; city: string;
  county?: string; postalCode?: string; countryCode?: string;
  isDefault?: boolean;
}) {
  if (payload.isDefault) {
    await supabaseAdmin.from('addresses').update({ is_default: false }).eq('user_id', userId);
  }
  const { data, error } = await supabaseAdmin
    .from('addresses')
    .insert({
      user_id:       userId,
      label:         payload.label ?? 'Home',
      recipient_name: payload.recipientName,
      phone:         payload.phone,
      address_line1: payload.addressLine1,
      address_line2: payload.addressLine2,
      city:          payload.city,
      county:        payload.county,
      postal_code:   payload.postalCode,
      country_code:  payload.countryCode ?? 'KE',
      is_default:    payload.isDefault ?? false,
    })
    .select()
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');
  return data;
}

export async function updateAddress(userId: string, addressId: string, payload: Partial<{
  label: string; recipientName: string; phone: string;
  addressLine1: string; addressLine2: string; city: string;
  county: string; postalCode: string; isDefault: boolean;
}>) {
  if (payload.isDefault) {
    await supabaseAdmin.from('addresses').update({ is_default: false }).eq('user_id', userId);
  }
  const updates: Record<string, unknown> = {};
  if (payload.label          !== undefined) updates.label          = payload.label;
  if (payload.recipientName  !== undefined) updates.recipient_name = payload.recipientName;
  if (payload.phone          !== undefined) updates.phone          = payload.phone;
  if (payload.addressLine1   !== undefined) updates.address_line1  = payload.addressLine1;
  if (payload.addressLine2   !== undefined) updates.address_line2  = payload.addressLine2;
  if (payload.city           !== undefined) updates.city           = payload.city;
  if (payload.county         !== undefined) updates.county         = payload.county;
  if (payload.postalCode     !== undefined) updates.postal_code    = payload.postalCode;
  if (payload.isDefault      !== undefined) updates.is_default     = payload.isDefault;

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .update(updates)
    .eq('id', addressId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error || !data) throw new NotFoundError('Address');
  return data;
}

export async function deleteAddress(userId: string, addressId: string) {
  const { error } = await supabaseAdmin
    .from('addresses')
    .delete()
    .eq('id', addressId)
    .eq('user_id', userId);
  if (error) throw new NotFoundError('Address');
}

// ─── Admin: list users ────────────────────────────────────────────────────────

export async function listUsers(query: { page?: string; limit?: string; role?: string; search?: string }) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('user_profiles')
    .select('id, first_name, last_name, phone, role, is_active, last_login_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.role)   q = q.eq('role', query.role);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function setUserRole(actorId: string, targetUserId: string, role: string) {
  if (actorId === targetUserId) throw new ForbiddenError('Cannot change your own role');
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update({ role })
    .eq('id', targetUserId)
    .select('id, role')
    .single();
  if (error || !data) throw new NotFoundError('User');
  return data;
}
