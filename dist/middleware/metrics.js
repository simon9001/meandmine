import { createMiddleware } from 'hono/factory';
import { httpRequestsTotal, httpRequestDuration } from '../config/metrics.js';
export const metricsMiddleware = createMiddleware(async (c, next) => {
    const start = Date.now();
    const route = c.req.routePath ?? c.req.path;
    await next();
    const status = String(c.res.status);
    const dur = (Date.now() - start) / 1000;
    httpRequestsTotal.inc({ method: c.req.method, route, status });
    httpRequestDuration.observe({ method: c.req.method, route, status }, dur);
});
