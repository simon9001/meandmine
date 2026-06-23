import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './shipments.controller.js';
const router = new Hono();
router.get('/order/:orderId', requireAuth, ctrl.getShipmentForOrder);
router.post('/', requireAuth, requireAdmin, ctrl.createShipment);
router.post('/:shipmentId/events', requireAuth, requireAdmin, ctrl.addTrackingEvent);
export default router;
