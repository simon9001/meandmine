import { Hono } from 'hono';
import * as ctrl from './analytics.controller.js';
const router = new Hono();
router.post('/track', ctrl.track); // public, no auth required
export default router;
