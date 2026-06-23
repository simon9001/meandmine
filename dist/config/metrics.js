import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
export const register = new Registry();
register.setDefaultLabels({ app: 'maschon-ecommerce' });
collectDefaultMetrics({ register });
export const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register],
});
export const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
});
export const ordersCreatedTotal = new Counter({
    name: 'orders_created_total',
    help: 'Total orders created',
    labelNames: ['status'],
    registers: [register],
});
export const paymentsProcessedTotal = new Counter({
    name: 'payments_processed_total',
    help: 'Total payments processed',
    labelNames: ['provider', 'status'],
    registers: [register],
});
export const productViewsTotal = new Counter({
    name: 'product_views_total',
    help: 'Total product page views',
    registers: [register],
});
export const metricsRegistry = register;
