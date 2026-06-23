import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3001),
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    CLOUDINARY_CLOUD_NAME: z.string().min(1),
    CLOUDINARY_API_KEY: z.string().min(1),
    CLOUDINARY_API_SECRET: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
    EMAIL_FROM: z.string().email().default('noreply@meandmine.co.ke'),
    EMAIL_FROM_NAME: z.string().default('MeAndMine'),
    APP_URL: z.string().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:3001'),
    FRONTEND_URL: z.string().default('https://maschon.netlify.app'),
    CORS_ORIGINS: z.string().default('https://maschon.netlify.app,http://localhost:3000,http://localhost:5173'),
    PAYSTACK_PUBLIC_KEY: z.string().min(1),
    PAYSTACK_SECRET_KEY: z.string().min(1),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().default(100),
    METRICS_TOKEN: z.string().optional(),
    REDIS_URL: z.string().url().optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().optional(),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('[env] Invalid environment variables:');
    console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
    process.exit(1);
}
export const env = parsed.data;
