import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './suppliers.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

// Supplier CRUD (admin)
router.get('/',                           requireAuth, requireAdmin, ctrl.listSuppliers);
router.get('/:id',                        requireAuth, requireAdmin, ctrl.getSupplierById);
router.post('/',                          requireAuth, requireAdmin, ctrl.createSupplier);
router.patch('/:id',                      requireAuth, requireAdmin, ctrl.updateSupplier);

// Product supply — public comparison + admin management
router.get('/products/:productId/supply',  ctrl.listProductSupply);
router.put('/supply',                      requireAuth, requireAdmin, ctrl.upsertProductSupply);
router.get('/products/:productId/pricing-history', requireAuth, requireAdmin, ctrl.getPricingHistory);

export default router;
