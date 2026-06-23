import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './products.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

// Public
router.get('/',                                         ctrl.listProducts);
router.get('/:slug',                                    ctrl.getProductBySlug);

// Admin — supplier intelligence (not for public)
router.get('/:productId/suppliers',  requireAuth, requireAdmin, ctrl.getSupplierComparison);

// Admin — product management
router.post('/',                     requireAuth, requireAdmin, ctrl.createProduct);
router.patch('/:id',                 requireAuth, requireAdmin, ctrl.updateProduct);
router.delete('/:id',                requireAuth, requireAdmin, ctrl.deleteProduct);

// Admin — media
router.post('/:productId/media',     requireAuth, requireAdmin, ctrl.addProductMedia);
router.delete('/:productId/media/:mediaId', requireAuth, requireAdmin, ctrl.deleteProductMedia);

// Admin — variants
router.post('/:productId/variants',                    requireAuth, requireAdmin, ctrl.createProductVariant);
router.delete('/:productId/variants/:variantId',       requireAuth, requireAdmin, ctrl.deleteProductVariant);

export default router;
