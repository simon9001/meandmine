import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './promotions.controller.js';
const router = new Hono();
// Public — returns only active promotions; ?type=hero_slide or ?type=navbar_banner
router.get('/', ctrl.listActivePromotions);
// Admin — must come before /:id so the literal path matches first
router.get('/all', requireAuth, requireAdmin, ctrl.adminListAllPromotions);
router.post('/', requireAuth, requireAdmin, ctrl.adminCreatePromotion);
router.patch('/:id', requireAuth, requireAdmin, ctrl.adminUpdatePromotion);
router.delete('/:id', requireAuth, requireAdmin, ctrl.adminDeletePromotion);
export default router;
