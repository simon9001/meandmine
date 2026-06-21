import type { Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import * as authService from './auth.service.js';
import { ok } from '../utils/response.js';
import { UnauthorizedError } from '../utils/errors.js';
import type { AppEnv } from '../types/index.js';

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const registerSchema = z.object({
  email:     z.string().email(),
  password:  passwordSchema,
  firstName: z.string().min(1).max(100).trim(),
  lastName:  z.string().min(1).max(100).trim(),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

const isProd = process.env.NODE_ENV === 'production';

function setAuthCookies(
  c: Context<AppEnv>,
  session: { access_token: string; refresh_token: string; expires_in?: number },
) {
  const base = { httpOnly: true, secure: isProd, sameSite: (isProd ? 'None' : 'Lax') as 'None' | 'Lax', path: '/' };
  setCookie(c, 'access_token',  session.access_token,  { ...base, maxAge: session.expires_in ?? 3600 });
  setCookie(c, 'refresh_token', session.refresh_token, { ...base, maxAge: 60 * 60 * 24 * 7 });
}

function clearAuthCookies(c: Context<AppEnv>) {
  deleteCookie(c, 'access_token',  { path: '/' });
  deleteCookie(c, 'refresh_token', { path: '/' });
}

export async function register(c: Context<AppEnv>) {
  const body = registerSchema.parse(await c.req.json());
  await authService.register(body.email, body.password, body.firstName, body.lastName);
  return ok(c, { message: 'Account created. A 6-digit code has been sent to your email.' }, 201);
}

export async function login(c: Context<AppEnv>) {
  const body = loginSchema.parse(await c.req.json());
  const session = await authService.login(body.email, body.password);
  setAuthCookies(c, session);
  return ok(c, { message: 'Logged in' });
}

export async function logout(c: Context<AppEnv>) {
  const token = getCookie(c, 'access_token') ?? c.req.header('Authorization')?.slice(7) ?? '';
  if (token) await authService.logout(token).catch(() => {});
  clearAuthCookies(c);
  return ok(c, { message: 'Logged out' });
}

export async function refresh(c: Context<AppEnv>) {
  // Cookie-first: browser sends refresh_token cookie automatically.
  // Body fallback kept for non-browser API clients.
  const cookieToken = getCookie(c, 'refresh_token');
  let bodyToken: string | undefined;
  try {
    const body = await c.req.json();
    bodyToken = (body as { refreshToken?: string }).refreshToken;
  } catch { /* empty body is fine */ }

  const token = cookieToken ?? bodyToken;
  if (!token) throw new UnauthorizedError('No refresh token');

  const session = await authService.refreshSession(token);
  setAuthCookies(c, session);
  return ok(c, { message: 'Token refreshed' });
}

export async function forgotPassword(c: Context<AppEnv>) {
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  await authService.forgotPassword(email);
  return ok(c, { message: 'If that email exists, a reset link has been sent' });
}

export async function resetPassword(c: Context<AppEnv>) {
  const body = z.object({
    email:    z.string().email(),
    token:    z.string().min(1),
    password: passwordSchema,
  }).parse(await c.req.json());
  await authService.resetPassword(body.email, body.token, body.password);
  return ok(c, { message: 'Password updated' });
}

export async function resendVerification(c: Context<AppEnv>) {
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  await authService.resendVerification(email);
  return ok(c, { message: 'If that email is registered and unverified, a new code has been sent' });
}

export async function verifyOtp(c: Context<AppEnv>) {
  const { email, otp } = z.object({
    email: z.string().email(),
    otp:   z.string().length(6).regex(/^\d{6}$/),
  }).parse(await c.req.json());
  const result = await authService.verifyOtp(email, otp);
  if (result.session) setAuthCookies(c, result.session);
  return ok(c, { verified: true, hasSession: !!result.session });
}

export async function getMe(c: Context<AppEnv>) {
  const authUser = c.get('user')!;
  const profile = await authService.getMe(authUser.id);
  return ok(c, { ...profile, email: authUser.email, isEmailVerified: true });
}
