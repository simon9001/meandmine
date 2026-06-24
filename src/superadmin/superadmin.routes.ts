import { Hono } from 'hono';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import * as ctrl from './superadmin.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth, requireSuperAdmin);

router.get('/analytics',        ctrl.getDetailedAnalytics);
router.get('/audit-logs',       ctrl.listAuditLogs);
router.delete('/users/:userId', ctrl.deleteUser);

export default router;
