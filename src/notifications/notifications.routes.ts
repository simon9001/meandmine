import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './notifications.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.get('/',              requireAuth, ctrl.listNotifications);
router.get('/unread-count',  requireAuth, ctrl.getUnreadCount);
router.post('/mark-read',    requireAuth, ctrl.markRead);
router.post('/mark-all-read', requireAuth, ctrl.markAllRead);

export default router;
