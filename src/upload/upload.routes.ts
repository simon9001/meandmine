import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './upload.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.post('/product',            requireAuth, requireAdmin, ctrl.uploadProductMediaImage);
router.post('/product/:productId', requireAuth, requireAdmin, ctrl.uploadProductImage);
router.post('/category',           requireAuth, requireAdmin, ctrl.uploadCategoryImage);
router.post('/avatar',             requireAuth,               ctrl.uploadAvatarImage);
router.post('/promotion',          requireAuth, requireAdmin, ctrl.uploadPromotionImage);
router.post('/review/:reviewId',   requireAuth,               ctrl.uploadReviewImage);
router.delete('/image',            requireAuth, requireAdmin, ctrl.deleteUploadedImage);

export default router;
