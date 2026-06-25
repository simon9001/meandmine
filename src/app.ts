import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { env } from './config/env.js';
import { metricsRegistry } from './config/metrics.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/errors.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { supabaseAdmin } from './config/db.js';
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
import superadminRoutes   from './superadmin/superadmin.routes.js';

const app = new Hono<AppEnv>();

// ─── Global middleware ──────────────────────────────────────────────────────────

app.use('*', trimTrailingSlash());

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '';
    const allowed = env.CORS_ORIGINS.split(',').map(o => o.trim());
    if (allowed.includes('*') || allowed.includes(origin)) return origin;
    // Allow all Vercel preview deployments for this project
    if (/^https:\/\/meandminefront[^.]*\.vercel\.app$/.test(origin)) return origin;
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

// ─── Keep-alive ping (public, open CORS — Render free-tier keep-alive) ────────
//
// Security design:
//   • In-memory counter: no DB call per request — a flood can't exhaust Supabase
//   • Counter syncs to DB at most once per 60 s (fire-and-forget)
//   • Seeded from DB on cold start so count survives restarts
//   • Dedicated per-IP rate limit: max 5 req / 60 s
//   • Rightmost IP from x-forwarded-for (spoofing-resistant)
//   • IP key capped at 45 chars (max IPv6 length) — prevents memory key abuse
//   • Store cleaned every 5 min to prevent unbounded memory growth
//   • Response is plain text only — no user input reflected, no XSS surface
//   • Cache-Control: no-store so CDNs don't serve stale "alive" responses

let _pingCount = 0;
let _pingLastSync = 0;

void (async () => {
  try {
    const { data } = await supabaseAdmin
      .from('ping_stats')
      .select('count')
      .eq('key', 'ping')
      .maybeSingle();
    if (data) _pingCount = Math.max(_pingCount, Number(data.count) || 0);
  } catch { /* DB not ready yet — start from 0 */ }
})();

function _flushPing(n: number) {
  const now = Date.now();
  if (now - _pingLastSync < 60_000) return;
  _pingLastSync = now;
  void (async () => {
    try {
      await supabaseAdmin
        .from('ping_stats')
        .upsert({ key: 'ping', count: n }, { onConflict: 'key' });
    } catch { /* non-critical */ }
  })();
}

const _pingStore = new Map<string, { n: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _pingStore) if (v.resetAt <= now) _pingStore.delete(k);
}, 5 * 60_000);

function _ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

app.get(
  '/ping',
  // Route-specific CORS overrides the global restricted CORS for this public endpoint
  cors({ origin: '*', allowMethods: ['GET'], maxAge: 0 }),
  // Rate limit: 5 requests per 60 s per IP
  (c, next) => {
    const forwarded = c.req.header('x-forwarded-for');
    // Rightmost IP = what the trusted proxy appended; leftmost can be spoofed by client
    const rawIp = (forwarded ? forwarded.split(',').at(-1)?.trim() : undefined)
      ?? c.req.header('x-real-ip')
      ?? 'unknown';
    const ip = rawIp.slice(0, 45); // cap at max IPv6 length

    const now = Date.now();
    const MAX = 5;
    const WINDOW = 60_000;
    let rec = _pingStore.get(ip);
    if (!rec || rec.resetAt <= now) {
      rec = { n: 1, resetAt: now + WINDOW };
      _pingStore.set(ip, rec);
    } else {
      rec.n++;
    }

    c.header('X-RateLimit-Limit',     String(MAX));
    c.header('X-RateLimit-Remaining', String(Math.max(0, MAX - rec.n)));
    c.header('X-RateLimit-Reset',     String(Math.ceil(rec.resetAt / 1000)));

    if (rec.n > MAX) {
      return c.text('Slow down! 🛑 Max 5 pings per minute per IP.', 429);
    }
    return next();
  },
  // Handler: pure in-memory — no DB call per request
  (c) => {
    _pingCount++;
    const count = _pingCount;
    _flushPing(count); // syncs to DB at most once per 60 s

    const ord = _ordinal(count);
    const messages = [
      `yooo!! thanks for waking me up 😤 mmmh! keeping me alive — this is the ${ord} time you are checking on me, I love you dear 💚`,
      `heyyy!! you came again 👀 this is the ${ord} ping — I was just about to fall asleep ngl 😴`,
      `ayyy!! I'm ALIVE!! 🎉 this is check number ${ord} — bless your heart for looking after me 🙏`,
      `wakey wakey!! 🐓 the ${ord} ping — you really out here keeping your server breathing huh, respect!`,
      `I'm here I'm here!! 💨 don't worry — ${ord} check confirmed, I ain't going nowhere 😤`,
    ];

    c.header('Cache-Control',        'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.text(`✅ I'm alive!\n\n${messages[count % messages.length]}\n\n⏰ ${new Date().toUTCString()}`);
  },
);

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
api.route('/superadmin',    superadminRoutes);

app.route('/api/v1', api);

// ─── Error handler ────────────────────────────────────────────────────────────

app.onError(errorHandler);

app.notFound((c) => c.json({ success: false, message: 'Route not found' }, 404));

export default app;
