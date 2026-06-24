import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as ctrl from './users.controller.js';
const router = new Hono();
// Profile
router.get('/profile', requireAuth, ctrl.getProfile);
router.patch('/profile', requireAuth, ctrl.updateProfile);
// Addresses
router.get('/addresses', requireAuth, ctrl.listAddresses);
router.post('/addresses', requireAuth, ctrl.createAddress);
router.patch('/addresses/:addressId', requireAuth, ctrl.updateAddress);
router.delete('/addresses/:addressId', requireAuth, ctrl.deleteAddress);
// Admin — user management
router.get('/', requireAuth, requireAdmin, ctrl.listUsers);
router.post('/', requireAuth, requireAdmin, ctrl.adminCreateUser);
router.patch('/:userId/role', requireAuth, requireAdmin, ctrl.setUserRole);
router.patch('/:userId', requireAuth, requireAdmin, ctrl.adminUpdateUser);
router.delete('/:userId', requireAuth, requireAdmin, ctrl.adminDeleteUser);
export default router;
