import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './orders.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

// Public — guest checkout & order tracking (no auth needed)
router.post('/guest',                    ctrl.createGuestOrder);
router.get('/track/:orderNumber',        ctrl.trackOrder);

// Customer
router.get('/my',                       requireAuth, ctrl.listMyOrders);
router.get('/my/:orderId',              requireAuth, ctrl.getMyOrder);
router.post('/',                        requireAuth, ctrl.createOrder);
router.post('/:orderId/cancel',         requireAuth, ctrl.cancelOrder);

// Admin
router.get('/',                         requireAuth, requireAdmin, ctrl.adminListOrders);
router.get('/:orderId',                 requireAuth, requireAdmin, ctrl.adminGetOrder);
router.patch('/:orderId/status',        requireAuth, requireAdmin, ctrl.updateOrderStatus);

export default router;
