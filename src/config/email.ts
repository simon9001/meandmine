import { Resend } from 'resend';
import { env } from './env.js';
import { logger } from './logger.js';

const resend = new Resend(env.RESEND_API_KEY);

resend.domains.list().then(() => {
  logger.info('Resend (email) connected', { from: env.EMAIL_FROM });
}).catch((err: Error) => {
  logger.warn('Resend connectivity check failed — emails may not send', { error: err.message });
});

export interface EmailPayload {
  to: { email: string; name?: string }[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const toAddresses = payload.to.map((r) =>
    r.name ? `${r.name} <${r.email}>` : r.email
  );

  const { error } = await resend.emails.send({
    from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`,
    to: toAddresses,
    subject: payload.subject,
    html: payload.html,
    ...(payload.text    && { text:    payload.text }),
    ...(payload.replyTo && { replyTo: payload.replyTo }),
  });

  if (error) {
    logger.error('Email send failed', { error: error.message, subject: payload.subject });
    throw new Error(error.message);
  }

  logger.info('Email sent', { to: payload.to.map((r) => r.email), subject: payload.subject });
}

export const templates = {
  otpVerification: (name: string, otp: string) => ({
    subject: 'Your verification code — MeAndMine',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <h1 style="color:#111">Verify your email</h1>
        <p>Hi${name ? ` ${name}` : ''},</p>
        <p>Enter the code below to verify your MeAndMine account.</p>
        <div style="background:#f4f4f4;border-radius:8px;padding:24px;text-align:center;margin:24px 0">
          <p style="font-size:36px;font-weight:700;letter-spacing:12px;color:#111;margin:0;font-family:monospace">${otp}</p>
        </div>
        <p style="color:#666;font-size:13px">Expires in 30 minutes. If you didn't sign up, ignore this email.</p>
      </div>`,
    text: `Your MeAndMine verification code is: ${otp}\n\nExpires in 30 minutes.`,
  }),

  welcome: (name: string) => ({
    subject: 'Welcome to MeAndMine!',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <h1 style="color:#111">Welcome, ${name}!</h1>
        <p>Your account is active. Start shopping at MeAndMine — quality home goods at the best prices.</p>
        <a href="${env.FRONTEND_URL}/shop" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:6px;margin-top:16px">
          Shop Now
        </a>
      </div>`,
  }),

  passwordReset: (link: string) => ({
    subject: 'Reset your MeAndMine password',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <h1 style="color:#111">Reset Your Password</h1>
        <p>Click the button below to reset your password. This link expires in 30 minutes.</p>
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:6px;margin-top:16px">
          Reset Password
        </a>
        <p style="color:#666;font-size:13px;margin-top:16px">If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  }),

  orderConfirmed: (orderNumber: string, total: number, customerName = '') => ({
    subject: `Order Confirmed — ${orderNumber}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <h1 style="color:#111">Order Confirmed!</h1>
        <p>Hi${customerName ? ` ${customerName}` : ''},</p>
        <p>Your order <strong>${orderNumber}</strong> has been placed successfully.</p>
        <p style="font-size:20px;font-weight:700">Total: KES ${total.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</p>
        <p>We'll notify you once your order ships.</p>
        <a href="${env.FRONTEND_URL}/account/orders" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:6px;margin-top:16px">
          View Order
        </a>
      </div>`,
  }),

  orderStatusUpdate: (orderNumber: string, status: string, customerName = '') => ({
    subject: `Order Update — ${orderNumber}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <h1 style="color:#111">Order Status Update</h1>
        <p>Hi${customerName ? ` ${customerName}` : ''},</p>
        <p>Your order <strong>${orderNumber}</strong> status has been updated to <strong>${status}</strong>.</p>
        <a href="${env.FRONTEND_URL}/account/orders" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:6px;margin-top:16px">
          Track Order
        </a>
      </div>`,
  }),

  shipmentDispatched: (orderNumber: string, trackingNumber: string, carrier: string) => ({
    subject: `Your order ${orderNumber} has shipped!`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <h1 style="color:#111">Your order is on its way!</h1>
        <p>Order <strong>${orderNumber}</strong> has been dispatched via <strong>${carrier}</strong>.</p>
        <p>Tracking number: <strong>${trackingNumber}</strong></p>
        <a href="${env.FRONTEND_URL}/account/orders" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:6px;margin-top:16px">
          Track Shipment
        </a>
      </div>`,
  }),
};
