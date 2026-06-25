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

function makeOtp(): string {
  return randomInt(100000, 1000000).toString();
}

async function issueOtp(email: string, userId: string, name: string): Promise<string> {
  const otp = makeOtp();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

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
async function incrementFailedLogin(_email: string) {
  // Placeholder: track brute-force attempts here once a failed_login_count
  // column is added to user_profiles. The previous implementation incorrectly
  // nulled last_login_at and fetched all users, which was both wrong and slow.
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
