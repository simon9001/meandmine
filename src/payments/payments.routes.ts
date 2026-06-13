import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './payments.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.post('/initialize',               requireAuth, ctrl.initializePayment);
router.get('/verify/:reference',         requireAuth, ctrl.verifyPayment);
router.get('/order/:orderId',            requireAuth, ctrl.getPaymentForOrder);
router.post('/webhook/paystack',                      ctrl.handleWebhook);

export default router;
