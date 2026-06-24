import { Hono } from 'hono';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import * as ctrl from './superadmin.controller.js';
const router = new Hono();
router.use('*', requireAuth, requireSuperAdmin);
router.get('/analytics', ctrl.getDetailedAnalytics);
router.get('/audit-logs', ctrl.listAuditLogs);
router.delete('/users/:userId', ctrl.deleteUser);
export default router;
