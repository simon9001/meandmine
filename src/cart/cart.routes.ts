import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './cart.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.get('/',                  ctrl.getCart);          // works for guests & auth users
router.post('/items',            ctrl.addToCart);
router.patch('/items/:itemId',   ctrl.updateCartItem);
router.delete('/items/:itemId',  ctrl.removeCartItem);
router.delete('/',               ctrl.clearCart);
router.post('/merge',            requireAuth, ctrl.mergeCart); // merge guest cart on login

export default router;
