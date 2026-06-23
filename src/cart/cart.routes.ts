import { Hono } from 'hono';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import * as ctrl from './cart.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.get('/',                  optionalAuth, ctrl.getCart);
router.post('/items',            optionalAuth, ctrl.addToCart);
router.patch('/items/:itemId',   optionalAuth, ctrl.updateCartItem);
router.delete('/items/:itemId',  optionalAuth, ctrl.removeCartItem);
router.delete('/',               optionalAuth, ctrl.clearCart);
router.post('/merge',            requireAuth,  ctrl.mergeCart);

export default router;
