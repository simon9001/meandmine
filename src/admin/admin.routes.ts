import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './admin.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth, requireAdmin);

router.get('/dashboard',              ctrl.getDashboardStats);
router.get('/analytics/revenue',      ctrl.getDailyRevenue);
router.get('/analytics/top-products', ctrl.getTopProducts);
router.get('/inventory/low-stock',    ctrl.getLowStockSummary);
router.post('/refresh-views',         ctrl.refreshMaterializedViews);

export default router;
