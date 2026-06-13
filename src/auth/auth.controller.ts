import type { Context } from 'hono';
import { z } from 'zod';
import * as authService from './auth.service.js';
import { ok } from '../utils/response.js';
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

export async function register(c: Context<AppEnv>) {
  const body = registerSchema.parse(await c.req.json());
  await authService.register(body.email, body.password, body.firstName, body.lastName);
  return ok(c, { message: 'Account created. A 6-digit code has been sent to your email.' }, 201);
}

export async function login(c: Context<AppEnv>) {
  const body = loginSchema.parse(await c.req.json());
  const session = await authService.login(body.email, body.password);
  return ok(c, { session });
}

export async function logout(c: Context<AppEnv>) {
  const token = c.req.header('Authorization')?.slice(7) ?? '';
  await authService.logout(token);
  return ok(c, { message: 'Logged out' });
}

export async function refresh(c: Context<AppEnv>) {
  const { refreshToken } = z.object({ refreshToken: z.string() }).parse(await c.req.json());
  const session = await authService.refreshSession(refreshToken);
  return ok(c, { session });
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
  return ok(c, result);
}

export async function getMe(c: Context<AppEnv>) {
  const authUser = c.get('user')!;
  const profile = await authService.getMe(authUser.id);
  return ok(c, { ...profile, email: authUser.email, isEmailVerified: true });
}
