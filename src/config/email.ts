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
    subject: `Order Received — ${orderNumber}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <h1 style="color:#111">Order Received!</h1>
        <p>Hi${customerName ? ` ${customerName}` : ''},</p>
        <p>We've received your order <strong>${orderNumber}</strong> and are awaiting your payment.</p>
        <p style="font-size:20px;font-weight:700">Total: KES ${total.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</p>
        <p>You'll receive a payment confirmation email once we verify your payment.</p>
        <a href="${env.FRONTEND_URL}/account/orders" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:6px;margin-top:16px">
          View Order
        </a>
      </div>`,
  }),

  paymentConfirmed: (
    orderNumber: string,
    total: number,
    customerName = '',
    items: { name: string; quantity: number; price: number }[] = [],
  ) => ({
    subject: `Payment Confirmed — ${orderNumber} ✓`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <div style="background:#f0fdf4;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
          <p style="font-size:40px;margin:0">✅</p>
          <h1 style="color:#15803d;margin:8px 0 4px">Payment Confirmed!</h1>
          <p style="color:#166534;margin:0;font-size:14px">Your order is now being processed</p>
        </div>

        <p>Hi${customerName ? ` ${customerName}` : ''},</p>
        <p>Great news! We've received your payment for order <strong>${orderNumber}</strong>. Your order is now confirmed and will be processed shortly.</p>

        ${items.length > 0 ? `
        <h3 style="color:#111;margin-top:24px;margin-bottom:12px;font-size:15px">Order Summary</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f9fafb">
              <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151">Item</th>
              <th style="text-align:center;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151">Qty</th>
              <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151">Price</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((i) => `
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#111">${i.name}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#111;text-align:center">${i.quantity}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#111;text-align:right">KES ${(i.price * i.quantity).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding:12px 12px 4px;font-weight:700;color:#111;text-align:right">Total Paid:</td>
              <td style="padding:12px 12px 4px;font-weight:700;font-size:16px;color:#15803d;text-align:right">KES ${total.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tfoot>
        </table>` : `
        <p style="font-size:20px;font-weight:700;color:#15803d">Total Paid: KES ${total.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</p>`}

        <p style="margin-top:24px">We'll send you another email when your order ships with tracking details.</p>

        <a href="${env.FRONTEND_URL}/account/orders" style="display:inline-block;padding:12px 28px;background:#15803d;color:#fff;text-decoration:none;border-radius:8px;margin-top:16px;font-weight:600">
          Track Your Order →
        </a>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0" />
        <p style="color:#9ca3af;font-size:12px">
          Order reference: <strong>${orderNumber}</strong><br />
          If you have any questions, reply to this email or visit our help centre.
        </p>
      </div>`,
    text: `Payment confirmed for order ${orderNumber}.\n\nTotal paid: KES ${total.toFixed(2)}\n\nTrack your order: ${env.FRONTEND_URL}/account/orders`,
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

  orderDispatched: (
    orderNumber: string,
    customerName: string,
    items: { name: string; quantity: number }[],
    dispatchInfo: {
      provider?:       string;
      parcelRef?:      string;
      trackingNo?:     string;
      collectionPoint?: string;
      dispatchNotes?:  string;
    } = {},
  ) => ({
    subject: `Your order ${orderNumber} is on the way! 🚚`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <div style="background:#eff6ff;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
          <p style="font-size:40px;margin:0">🚚</p>
          <h1 style="color:#1d4ed8;margin:8px 0 4px">Your Order Is On The Way!</h1>
          <p style="color:#1e40af;margin:0;font-size:14px">Order <strong>${orderNumber}</strong> has been dispatched</p>
        </div>
        <p>Hi${customerName ? ` ${customerName}` : ''},</p>
        <p>Great news! Your order has been dispatched and is on its way to you.</p>
        ${items.length > 0 ? `
        <h3 style="color:#111;margin-top:24px;margin-bottom:12px;font-size:15px">Items In This Order</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tbody>
            ${items.map((i) => `
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#111">${i.name}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;text-align:right">× ${i.quantity}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : ''}
        <div style="background:#f9fafb;border-radius:8px;padding:20px;margin-top:24px">
          <h3 style="color:#111;margin:0 0 12px;font-size:14px;font-weight:600">Dispatch Details</h3>
          ${dispatchInfo.provider        ? `<p style="margin:4px 0;font-size:13px;color:#374151"><strong>Provider:</strong> ${dispatchInfo.provider}</p>` : ''}
          ${dispatchInfo.parcelRef       ? `<p style="margin:4px 0;font-size:13px;color:#374151"><strong>Parcel Reference:</strong> ${dispatchInfo.parcelRef}</p>` : ''}
          ${dispatchInfo.trackingNo      ? `<p style="margin:4px 0;font-size:13px;color:#374151"><strong>Tracking Number:</strong> ${dispatchInfo.trackingNo}</p>` : ''}
          ${dispatchInfo.collectionPoint ? `<p style="margin:4px 0;font-size:13px;color:#374151"><strong>Collection Point:</strong> ${dispatchInfo.collectionPoint}</p>` : ''}
          ${dispatchInfo.dispatchNotes   ? `<p style="margin:4px 0;font-size:13px;color:#374151"><strong>Notes:</strong> ${dispatchInfo.dispatchNotes}</p>` : ''}
        </div>
        <p style="margin-top:24px">Track the status of your order from your account dashboard.</p>
        <a href="${env.FRONTEND_URL}/account/orders" style="display:inline-block;padding:12px 28px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;margin-top:16px;font-weight:600">
          Track Your Order →
        </a>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0" />
        <p style="color:#9ca3af;font-size:12px">
          Order reference: <strong>${orderNumber}</strong><br />
          If you have any questions, reply to this email.
        </p>
      </div>`,
    text: `Your order ${orderNumber} has been dispatched!\n\n${dispatchInfo.provider ? `Provider: ${dispatchInfo.provider}\n` : ''}${dispatchInfo.parcelRef ? `Parcel Ref: ${dispatchInfo.parcelRef}\n` : ''}${dispatchInfo.trackingNo ? `Tracking: ${dispatchInfo.trackingNo}\n` : ''}${dispatchInfo.collectionPoint ? `Collection Point: ${dispatchInfo.collectionPoint}\n` : ''}\nTrack your order: ${env.FRONTEND_URL}/account/orders`,
  }),
};
