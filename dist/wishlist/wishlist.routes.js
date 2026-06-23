import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './wishlist.controller.js';
const router = new Hono();
router.get('/', requireAuth, ctrl.listWishlist);
router.post('/', requireAuth, ctrl.addToWishlist);
router.delete('/:id', requireAuth, ctrl.removeFromWishlist);
router.get('/check/:productId', requireAuth, ctrl.checkInWishlist);
export default router;
