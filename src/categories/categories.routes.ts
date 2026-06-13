import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './categories.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.get('/',           ctrl.listCategories);
router.get('/:slug',      ctrl.getCategoryBySlug);
router.post('/',          requireAuth, requireAdmin, ctrl.createCategory);
router.patch('/:id',      requireAuth, requireAdmin, ctrl.updateCategory);
router.delete('/:id',     requireAuth, requireAdmin, ctrl.deleteCategory);

export default router;
