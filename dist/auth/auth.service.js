import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../config/db.js';
import { env } from '../config/env.js';
import { sendEmail, templates } from '../config/email.js';
import { logger } from '../config/logger.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';
function anonClient() {
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}
function makeOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
async function issueOtp(email, userId, name) {
    const otp = makeOtp();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await supabaseAdmin.from('email_otps').delete().eq('email', email);
    const { error } = await supabaseAdmin.from('email_otps').insert({
        email, otp, expires_at: expiresAt, user_id: userId, user_name: name,
    });
    if (error)
        throw new Error(`OTP storage failed: ${error.message}`);
    return otp;
}
// ─── Register ─────────────────────────────────────────────────────────────────
export async function register(email, password, firstName, lastName) {
    const name = `${firstName} ${lastName}`.trim();
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: { first_name: firstName, last_name: lastName, name },
    });
    if (error) {
        const msg = error.message.toLowerCase();
        // User exists — check if they are still unconfirmed (e.g. OTP step crashed last time)
        if (msg.includes('already registered') || msg.includes('already been registered')) {
            const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 10000 });
            const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
            if (existing && !existing.email_confirmed_at) {
                // Update the password in case they typed a different one this time
                await supabaseAdmin.auth.admin.updateUserById(existing.id, { password });
                const otp = await issueOtp(email, existing.id, name);
                try {
                    await sendEmail({ to: [{ email, name }], ...templates.otpVerification(name, otp) });
                }
                catch {
                    throw new BadRequestError('Could not send verification email. Please try again.');
                }
                return existing;
            }
            throw new BadRequestError('Email already in use');
        }
        throw new BadRequestError(error.message);
    }
    const otp = await issueOtp(email, data.user.id, name);
    try {
        await sendEmail({ to: [{ email, name }], ...templates.otpVerification(name, otp) });
    }
    catch {
        await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => { });
        await supabaseAdmin.from('email_otps').delete().eq('email', email).then(undefined, () => { });
        throw new BadRequestError('Could not send verification email. Please try again.');
    }
    return data.user;
}
// ─── Resend verification ──────────────────────────────────────────────────────
export async function resendVerification(email) {
    const { data: otpRow } = await supabaseAdmin
        .from('email_otps')
        .select('user_id, user_name')
        .eq('email', email)
        .maybeSingle();
    let userId;
    let name;
    if (otpRow?.user_id) {
        userId = otpRow.user_id;
        name = otpRow.user_name ?? '';
        const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (!user || user.email_confirmed_at)
            return;
    }
    else {
        const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 10000 });
        const authUser = users.find((u) => u.email === email);
        if (!authUser || authUser.email_confirmed_at)
            return;
        userId = authUser.id;
        name = authUser.user_metadata?.name ?? '';
    }
    const otp = await issueOtp(email, userId, name);
    sendEmail({ to: [{ email, name }], ...templates.otpVerification(name, otp) }).catch(() => { });
}
// ─── Verify OTP ───────────────────────────────────────────────────────────────
export async function verifyOtp(email, otp) {
    const { data: row, error } = await supabaseAdmin
        .from('email_otps')
        .select('otp, expires_at, user_id, user_name')
        .eq('email', email)
        .eq('otp', otp)
        .maybeSingle();
    if (error || !row)
        throw new BadRequestError('Invalid verification code');
    if (new Date(row.expires_at) < new Date()) {
        await supabaseAdmin.from('email_otps').delete().eq('email', email);
        throw new BadRequestError('Verification code expired. Please request a new one.');
    }
    const userId = row.user_id;
    const name = row.user_name ?? '';
    await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
    await supabaseAdmin.from('email_otps').delete().eq('email', email);
    // Parse name into first/last
    const parts = name.trim().split(' ');
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ') || '';
    await supabaseAdmin.from('user_profiles').upsert({ id: userId, first_name: firstName, last_name: lastName, role: 'customer', is_active: true }, { onConflict: 'id' });
    sendEmail({ to: [{ email, name }], ...templates.welcome(name) }).catch(() => { });
    try {
        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink', email,
        });
        if (linkErr || !linkData?.properties?.hashed_token)
            return { session: null };
        const { data: sessionData, error: sessionErr } = await anonClient().auth.verifyOtp({
            token_hash: linkData.properties.hashed_token,
            type: 'magiclink',
        });
        if (sessionErr || !sessionData?.session)
            return { session: null };
        return { session: sessionData.session };
    }
    catch (err) {
        logger.warn('verifyOtp: auto-login failed', { email, error: err.message });
        return { session: null };
    }
}
// ─── Login ────────────────────────────────────────────────────────────────────
export async function login(email, password) {
    const client = anonClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
            throw new UnauthorizedError('EMAIL_NOT_VERIFIED');
        }
        await incrementFailedLogin(email);
        throw new UnauthorizedError('Invalid email or password');
    }
    // Reset failed login counter
    await supabaseAdmin
        .from('user_profiles')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', data.user.id);
    return data.session;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function incrementFailedLogin(_email) {
    // Placeholder: track brute-force attempts here once a failed_login_count
    // column is added to user_profiles. The previous implementation incorrectly
    // nulled last_login_at and fetched all users, which was both wrong and slow.
}
// ─── Logout ───────────────────────────────────────────────────────────────────
export async function logout(accessToken) {
    await supabaseAdmin.auth.admin.signOut(accessToken);
}
// ─── Refresh ──────────────────────────────────────────────────────────────────
export async function refreshSession(refreshToken) {
    const client = anonClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session)
        throw new UnauthorizedError('Invalid refresh token');
    return data.session;
}
// ─── Forgot / Reset password ──────────────────────────────────────────────────
export async function forgotPassword(email) {
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 10000 });
    const authUser = users.find((u) => u.email === email);
    if (!authUser)
        return; // silent no-op prevents email enumeration
    const name = authUser.user_metadata?.name ?? '';
    const token = await issueOtp(email, authUser.id, name);
    const resetLink = `${env.FRONTEND_URL}/auth/reset-password?email=${encodeURIComponent(email)}&token=${token}`;
    try {
        await sendEmail({ to: [{ email, name }], ...templates.passwordReset(resetLink) });
    }
    catch (err) {
        logger.error('forgotPassword: email send failed', { email, error: err.message });
    }
}
export async function resetPassword(email, token, newPassword) {
    const { data: row } = await supabaseAdmin
        .from('email_otps')
        .select('otp, expires_at, user_id')
        .eq('email', email)
        .eq('otp', token)
        .maybeSingle();
    if (!row)
        throw new UnauthorizedError('Invalid or expired reset link');
    if (new Date(row.expires_at) < new Date()) {
        await supabaseAdmin.from('email_otps').delete().eq('email', email);
        throw new UnauthorizedError('Reset link expired — please request a new one');
    }
    const userId = row.user_id;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
    if (error)
        throw new BadRequestError(error.message);
    await supabaseAdmin.from('email_otps').delete().eq('email', email);
}
// ─── Me ───────────────────────────────────────────────────────────────────────
export async function getMe(userId) {
    const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('id, first_name, last_name, phone, role, avatar_url, preferred_currency, is_active, last_login_at, created_at')
        .eq('id', userId)
        .single();
    if (error || !data)
        throw new UnauthorizedError('Profile not found');
    return {
        id: data.id,
        role: data.role,
        firstName: data.first_name,
        lastName: data.last_name,
        phone: data.phone,
        avatarUrl: data.avatar_url ?? null,
    };
}
