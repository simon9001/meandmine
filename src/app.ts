import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { env } from './config/env.js';
import { metricsRegistry } from './config/metrics.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/errors.js';
import { metricsMiddleware } from './middleware/metrics.js';
import type { AppEnv } from './types/index.js';

import authRoutes         from './auth/auth.routes.js';
import userRoutes         from './users/users.routes.js';
import categoryRoutes     from './categories/categories.routes.js';
import productRoutes      from './products/products.routes.js';
import supplierRoutes     from './suppliers/suppliers.routes.js';
import inventoryRoutes    from './inventory/inventory.routes.js';
import cartRoutes         from './cart/cart.routes.js';
import discountRoutes     from './discount-codes/discount-codes.routes.js';
import orderRoutes        from './orders/orders.routes.js';
import paymentRoutes      from './payments/payments.routes.js';
import reviewRoutes       from './reviews/reviews.routes.js';
import wishlistRoutes     from './wishlist/wishlist.routes.js';
import shipmentRoutes     from './shipments/shipments.routes.js';
import notificationRoutes from './notifications/notifications.routes.js';
import uploadRoutes       from './upload/upload.routes.js';
import adminRoutes        from './admin/admin.routes.js';
import analyticsRoutes    from './analytics/analytics.routes.js';
import promotionRoutes    from './promotions/promotions.routes.js';

const app = new Hono<AppEnv>();

// ─── Global middleware ──────────────────────────────────────────────────────────

app.use('*', trimTrailingSlash());

app.use('*', cors({
  origin: (origin) => {
    const allowed = env.CORS_ORIGINS.split(',').map(o => o.trim());
    if (!origin || allowed.includes('*') || allowed.includes(origin)) return origin ?? '';
    return '';
  },
  allowMethods:  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders:  ['Content-Type', 'Authorization', 'X-Session-Id', 'X-Request-Id'],
  exposeHeaders: ['X-Request-Id'],
  maxAge:        86400,
  credentials:   true,
}));

app.use('*', secureHeaders({
  xFrameOptions:         'DENY',
  xContentTypeOptions:   'nosniff',
  referrerPolicy:        'strict-origin-when-cross-origin',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
}));

app.use('*', requestLogger);
app.use('*', metricsMiddleware);

// ─── Health & metrics ─────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), env: env.NODE_ENV }));

app.get('/metrics', async (c) => {
  const token = c.req.header('Authorization');
  if (env.METRICS_TOKEN && token !== `Bearer ${env.METRICS_TOKEN}`) {
    return c.text('Unauthorized', 401);
  }
  return c.text(await metricsRegistry.metrics(), 200, { 'Content-Type': metricsRegistry.contentType });
});

// ─── Routes ──────────────────────────────────────────────────────────────────

const api = new Hono<AppEnv>();

api.route('/auth',          authRoutes);
api.route('/users',         userRoutes);
api.route('/categories',    categoryRoutes);
api.route('/products',      productRoutes);
api.route('/suppliers',     supplierRoutes);
api.route('/inventory',     inventoryRoutes);
api.route('/cart',          cartRoutes);
api.route('/discount-codes', discountRoutes);
api.route('/orders',        orderRoutes);
api.route('/payments',      paymentRoutes);
api.route('/reviews',       reviewRoutes);
api.route('/wishlist',      wishlistRoutes);
api.route('/shipments',     shipmentRoutes);
api.route('/notifications', notificationRoutes);
api.route('/upload',        uploadRoutes);
api.route('/admin',         adminRoutes);
api.route('/analytics',     analyticsRoutes);
api.route('/promotions',    promotionRoutes);

app.route('/api/v1', api);

// ─── Error handler ────────────────────────────────────────────────────────────

app.onError(errorHandler);

app.notFound((c) => c.json({ success: false, message: 'Route not found' }, 404));

export default app;
