import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit, sensitiveRateLimit } from '../middleware/rateLimit.js';
import * as ctrl from './auth.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.post('/register',            sensitiveRateLimit(), ctrl.register);
router.post('/login',               authRateLimit(),      ctrl.login);
router.post('/refresh',             authRateLimit(),      ctrl.refresh);
router.post('/forgot-password',     sensitiveRateLimit(), ctrl.forgotPassword);
router.post('/verify-otp',          sensitiveRateLimit(), ctrl.verifyOtp);
router.post('/resend-verification', sensitiveRateLimit(), ctrl.resendVerification);
router.post('/logout',              requireAuth,          ctrl.logout);
router.post('/reset-password',      sensitiveRateLimit(), ctrl.resetPassword);
router.get('/me',                   requireAuth,          ctrl.getMe);

export default router;
