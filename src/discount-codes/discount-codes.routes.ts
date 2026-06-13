import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './discount-codes.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.post('/validate',  requireAuth,               ctrl.validateCode);
router.get('/',           requireAuth, requireAdmin, ctrl.listCodes);
router.post('/',          requireAuth, requireAdmin, ctrl.createCode);
router.patch('/:id',      requireAuth, requireAdmin, ctrl.updateCode);

export default router;
