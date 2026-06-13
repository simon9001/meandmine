import { createMiddleware } from 'hono/factory';
import { supabaseAdmin, createUserClient } from '../config/db.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import type { AppEnv, UserRole } from '../types/index.js';

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }
  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new UnauthorizedError('Invalid or expired token');

  if (!user.email_confirmed_at) {
    throw new UnauthorizedError('Email not verified. Please check your inbox.');
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) throw new UnauthorizedError('Profile not found');
  if (!profile.is_active) throw new ForbiddenError('Account suspended');

  c.set('user', { id: user.id, email: user.email!, role: profile.role as UserRole });
  c.set('userClient', createUserClient(token));

  await next();
});

export const requireRole = (...roles: UserRole[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenError('Insufficient permissions');
    }
    await next();
  });

export const requireAdmin = requireRole('admin', 'superadmin');
