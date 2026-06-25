import { randomInt } from 'crypto';
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

// ─── Per-email login brute-force protection ───────────────────────────────────
// Complements the IP-based rate limiter on the route: that stops floods from
// one IP; this stops distributed attacks targeting one account from many IPs.
// 5 failures within a window → 15-minute lockout for that email address.

const _loginAttempts = new Map<string, { failures: number; lockedUntil: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _loginAttempts) if (v.lockedUntil > 0 && v.lockedUntil <= now) _loginAttempts.delete(k);
}, 10 * 60_000);

function _checkLoginLock(email: string): void {
  const rec = _loginAttempts.get(email.toLowerCase());
  if (rec && Date.now() < rec.lockedUntil) {
    const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
    throw new UnauthorizedError(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}

function _recordLoginFailure(email: string): void {
  const key = email.toLowerCase();
  const rec = _loginAttempts.get(key) ?? { failures: 0, lockedUntil: 0 };
  rec.failures++;
  if (rec.failures >= 5) {
    rec.lockedUntil = Date.now() + 15 * 60_000;
    rec.failures = 0; // reset so counter restarts after lockout lifts
  }
  _loginAttempts.set(key, rec);
}

function _clearLoginLock(email: string): void {
  _loginAttempts.delete(email.toLowerCase());
}

// ─── Per-email OTP rate limit ─────────────────────────────────────────────────
// Stops an attacker with many IPs from brute-forcing a known email's OTP.
// Max 5 attempts per email per 15 minutes.

const _otpAttempts = new Map<string, { tries: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _otpAttempts) if (v.resetAt <= now) _otpAttempts.delete(k);
}, 10 * 60_000);

function _checkOtpLimit(email: string): void {
  const key = email.toLowerCase();
  const rec = _otpAttempts.get(key);
  if (rec && Date.now() < rec.resetAt && rec.tries >= 5) {
    const mins = Math.ceil((rec.resetAt - Date.now()) / 60_000);
    throw new BadRequestError(`Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}

function _recordOtpAttempt(email: string): void {
  const key = email.toLowerCase();
  const now = Date.now();
  const rec = _otpAttempts.get(key);
  if (!rec || now >= rec.resetAt) {
    _otpAttempts.set(key, { tries: 1, resetAt: now + 15 * 60_000 });
  } else {
    rec.tries++;
  }
}

function _clearOtpAttempts(email: string): void {
  _otpAttempts.delete(email.toLowerCase());
}

function makeOtp(): string {
  return randomInt(100000, 1000000).toString();
}

async function issueOtp(email: string, userId: string, name: string): Promise<string> {
  const otp = makeOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min — industry standard for 6-digit OTPs

  await supabaseAdmin.from('email_otps').delete().eq('email', email);
  const { error } = await supabaseAdmin.from('email_otps').insert({
    email, otp, expires_at: expiresAt, user_id: userId, user_name: name,
  });
  if (error) throw new Error(`OTP storage failed: ${error.message}`);

  return otp;
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(email: string, password: string, firstName: string, lastName: string) {
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
        // Unconfirmed — update password and resend OTP silently
        await supabaseAdmin.auth.admin.updateUserById(existing.id, { password });

        const otp = await issueOtp(email, existing.id, name);
        try {
          await sendEmail({ to: [{ email, name }], ...templates.otpVerification(name, otp) });
        } catch {
          throw new BadRequestError('Could not send verification email. Please try again.');
        }
        return existing;
      }

      // Confirmed account: don't reveal that this email is registered —
      // return the same generic "check your email" flow to prevent enumeration.
      // Fire-and-forget a "someone tried to register with your email" warning.
      const confirmedUser = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (confirmedUser) {
        sendEmail({
          to: [{ email, name: (confirmedUser.user_metadata?.name as string) ?? '' }],
          subject: 'Someone tried to create an account using your email',
          html: `<p>Someone attempted to create a new MeAndMine.shop account with your email address. If this was you, please <a href="${env.FRONTEND_URL}/auth/login">sign in</a> instead. If it wasn't you, you can safely ignore this email.</p>`,
          text: `Someone attempted to create a new MeAndMine.shop account with your email address. If this was you, please sign in at ${env.FRONTEND_URL}/auth/login instead.`,
        }).catch(() => {});
      }
      // Return the same shape as a successful registration — front-end shows "check your email"
      return { id: '', email } as { id: string; email: string };
    }

    throw new BadRequestError(error.message);
  }

  const otp = await issueOtp(email, data.user.id, name);

  try {
    await sendEmail({ to: [{ email, name }], ...templates.otpVerification(name, otp) });
  } catch {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {});
    await supabaseAdmin.from('email_otps').delete().eq('email', email).then(undefined, () => {});
    throw new BadRequestError('Could not send verification email. Please try again.');
  }

  return data.user;
}

// ─── Resend verification ──────────────────────────────────────────────────────

export async function resendVerification(email: string) {
  const { data: otpRow } = await supabaseAdmin
    .from('email_otps')
    .select('user_id, user_name')
    .eq('email', email)
    .maybeSingle();

  let userId: string;
  let name: string;

  if (otpRow?.user_id) {
    userId = otpRow.user_id as string;
    name   = (otpRow.user_name as string) ?? '';
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (!user || user.email_confirmed_at) return;
  } else {
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 10000 });
    const authUser = users.find((u) => u.email === email);
    if (!authUser || authUser.email_confirmed_at) return;
    userId = authUser.id;
    name   = (authUser.user_metadata?.name as string) ?? '';
  }

  const otp = await issueOtp(email, userId, name);
  sendEmail({ to: [{ email, name }], ...templates.otpVerification(name, otp) }).catch(() => {});
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────

export async function verifyOtp(email: string, otp: string) {
  _checkOtpLimit(email);   // throws if too many attempts for this email
  _recordOtpAttempt(email); // count this attempt before hitting the DB

  const { data: row, error } = await supabaseAdmin
    .from('email_otps')
    .select('otp, expires_at, user_id, user_name')
    .eq('email', email)
    .eq('otp', otp)
    .maybeSingle();

  if (error || !row) throw new BadRequestError('Invalid verification code');

  if (new Date(row.expires_at as string) < new Date()) {
    await supabaseAdmin.from('email_otps').delete().eq('email', email);
    throw new BadRequestError('Verification code expired. Please request a new one.');
  }

  const userId = row.user_id as string;
  const name   = (row.user_name as string) ?? '';

  _clearOtpAttempts(email); // correct code — wipe the attempt counter

  await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
  await supabaseAdmin.from('email_otps').delete().eq('email', email);

  // Parse name into first/last
  const parts = name.trim().split(' ');
  const firstName = parts[0] ?? '';
  const lastName  = parts.slice(1).join(' ') || '';

  await supabaseAdmin.from('user_profiles').upsert(
    { id: userId, first_name: firstName, last_name: lastName, role: 'customer', is_active: true },
    { onConflict: 'id' }
  );

  sendEmail({ to: [{ email, name }], ...templates.welcome(name) }).catch(() => {});

  try {
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink', email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) return { session: null };

    const { data: sessionData, error: sessionErr } = await anonClient().auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    });
    if (sessionErr || !sessionData?.session) return { session: null };

    return { session: sessionData.session };
  } catch (err) {
    logger.warn('verifyOtp: auto-login failed', { email, error: (err as Error).message });
    return { session: null };
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  _checkLoginLock(email); // throws if this email is currently locked out

  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
      throw new UnauthorizedError('EMAIL_NOT_VERIFIED');
    }
    _recordLoginFailure(email); // 5 failures → 15-min lockout
    throw new UnauthorizedError('Invalid email or password');
  }

  _clearLoginLock(email); // success — wipe any previous failure count

  await supabaseAdmin
    .from('user_profiles')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', data.user.id);

  return data.session;
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(accessToken: string) {
  await supabaseAdmin.auth.admin.signOut(accessToken);
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function refreshSession(refreshToken: string) {
  const client = anonClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) throw new UnauthorizedError('Invalid refresh token');
  return data.session;
}

// ─── Forgot / Reset password ──────────────────────────────────────────────────

export async function forgotPassword(email: string) {
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 10000 });
  const authUser = users.find((u) => u.email === email);
  if (!authUser) return; // silent no-op prevents email enumeration

  const name = (authUser.user_metadata?.name as string) ?? '';
  const token = await issueOtp(email, authUser.id, name);
  const resetLink = `${env.FRONTEND_URL}/auth/reset-password?email=${encodeURIComponent(email)}&token=${token}`;

  try {
    await sendEmail({ to: [{ email, name }], ...templates.passwordReset(resetLink) });
  } catch (err) {
    logger.error('forgotPassword: email send failed', { email, error: (err as Error).message });
  }
}

export async function resetPassword(email: string, token: string, newPassword: string) {
  const { data: row } = await supabaseAdmin
    .from('email_otps')
    .select('otp, expires_at, user_id')
    .eq('email', email)
    .eq('otp', token)
    .maybeSingle();

  if (!row) throw new UnauthorizedError('Invalid or expired reset link');

  if (new Date(row.expires_at as string) < new Date()) {
    await supabaseAdmin.from('email_otps').delete().eq('email', email);
    throw new UnauthorizedError('Reset link expired — please request a new one');
  }

  const userId = row.user_id as string;
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) throw new BadRequestError(error.message);

  await supabaseAdmin.from('email_otps').delete().eq('email', email);
}

// ─── Me ───────────────────────────────────────────────────────────────────────

export async function getMe(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('id, first_name, last_name, phone, role, avatar_url, preferred_currency, is_active, last_login_at, created_at')
    .eq('id', userId)
    .single();

  if (error || !data) throw new UnauthorizedError('Profile not found');

  return {
    id:        data.id,
    role:      data.role,
    firstName: data.first_name,
    lastName:  data.last_name,
    phone:     data.phone,
    avatarUrl: data.avatar_url ?? null,
  };
}
