import { Hono } from 'hono';
import * as ctrl from './analytics.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.post('/track', ctrl.track); // public, no auth required

export default router;
