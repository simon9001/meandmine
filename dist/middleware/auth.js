import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { supabaseAdmin, createUserClient } from '../config/db.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
export const requireAuth = createMiddleware(async (c, next) => {
    // Prefer httpOnly cookie (browser). Fall back to Authorization header (API clients / mobile).
    const authHeader = c.req.header('Authorization');
    const token = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
        ?? getCookie(c, 'access_token')
        ?? null;
    if (!token)
        throw new UnauthorizedError('Authentication required');
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user)
        throw new UnauthorizedError('Invalid or expired token');
    if (!user.email_confirmed_at) {
        throw new UnauthorizedError('Email not verified. Please check your inbox.');
    }
    const { data: profile, error: profileErr } = await supabaseAdmin
        .from('user_profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .single();
    if (profileErr || !profile)
        throw new UnauthorizedError('Profile not found');
    if (!profile.is_active)
        throw new ForbiddenError('Account suspended');
    c.set('user', { id: user.id, email: user.email, role: profile.role });
    c.set('userClient', createUserClient(token));
    await next();
});
export const requireRole = (...roles) => createMiddleware(async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
        throw new ForbiddenError('Insufficient permissions');
    }
    await next();
});
export const requireAdmin = requireRole('admin', 'superadmin');
