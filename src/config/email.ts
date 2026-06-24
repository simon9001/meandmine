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
    delivery?: {
      recipientName?: string;
      phone?: string;
      county?: string;
      town?: string;
      stage?: string;
      deliveryMethod?: string;
      instructions?: string;
    },
    discount?: number,
    placedAt?: string,
  ) => {
    const fmt = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const dateStr  = placedAt
      ? new Date(placedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });

    const waLink  = 'https://wa.me/254757568845';
    const waText  = encodeURIComponent(`Hi, I have an enquiry about my MeAndMine order ${orderNumber}`);

    const deliveryLabel = delivery?.deliveryMethod === 'pickup' ? 'Self Pickup' : 'Home Delivery';
    const deliveryAddr  = delivery
      ? [delivery.town, delivery.county, delivery.stage].filter(Boolean).join(', ')
      : '';

    return {
      subject: `🎉 Order Confirmed — ${orderNumber}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

    <!-- Header -->
    <tr><td style="background:linear-gradient(135deg,#1a3828 0%,#2d5016 100%);border-radius:16px 16px 0 0;padding:32px 36px;text-align:center">
      <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#a3c4a8">MeAndMine.shop</p>
      <p style="margin:12px 0 4px;font-size:42px">🎉</p>
      <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff">Order Confirmed!</h1>
      <p style="margin:8px 0 0;font-size:14px;color:#a3c4a8">Thank you, ${customerName || 'valued customer'}. Your payment has been received.</p>
    </td></tr>

    <!-- Order meta strip -->
    <tr><td style="background:#ffffff;padding:20px 36px;border-bottom:1px solid #f3f4f6">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:12px;color:#6b7280">Order number</td>
          <td style="font-size:12px;color:#6b7280;text-align:right">Date</td>
        </tr>
        <tr>
          <td style="font-size:15px;font-weight:700;color:#111827">${orderNumber}</td>
          <td style="font-size:13px;color:#374151;text-align:right">${dateStr}</td>
        </tr>
      </table>
    </td></tr>

    <!-- Items table -->
    <tr><td style="background:#ffffff;padding:24px 36px 0">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">Items Ordered</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
        <tr style="background:#f9fafb">
          <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600">Product</th>
          <th style="text-align:center;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600">Qty</th>
          <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600">Amount</th>
        </tr>
        ${items.map((i, idx) => `
        <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#fafafa'}">
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#111827">${i.name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;text-align:center">${i.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#111827;text-align:right;font-weight:600">${fmt(i.price * i.quantity)}</td>
        </tr>`).join('')}
        ${items.length > 1 ? `
        <tr>
          <td colspan="2" style="padding:10px 12px;color:#6b7280;font-size:12px">Subtotal</td>
          <td style="padding:10px 12px;text-align:right;color:#374151">${fmt(subtotal)}</td>
        </tr>` : ''}
        ${discount && discount > 0 ? `
        <tr>
          <td colspan="2" style="padding:6px 12px;color:#15803d;font-size:12px">Discount</td>
          <td style="padding:6px 12px;text-align:right;color:#15803d">− ${fmt(discount)}</td>
        </tr>` : ''}
        <tr style="background:#1a3828">
          <td colspan="2" style="padding:14px 12px;font-weight:700;color:#ffffff;font-size:14px">Total Paid</td>
          <td style="padding:14px 12px;font-weight:800;font-size:16px;color:#c47b2a;text-align:right">${fmt(total)}</td>
        </tr>
      </table>
    </td></tr>

    <!-- Delivery info -->
    ${delivery ? `
    <tr><td style="background:#ffffff;padding:24px 36px 0;margin-top:4px">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">Delivery Details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px;padding:16px;font-size:13px">
        <tr>
          <td style="padding:5px 0;color:#6b7280;width:140px">Recipient</td>
          <td style="padding:5px 0;color:#111827;font-weight:600">${delivery.recipientName || customerName}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#6b7280">Phone</td>
          <td style="padding:5px 0;color:#111827">${delivery.phone || '—'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#6b7280">Method</td>
          <td style="padding:5px 0;color:#111827">${deliveryLabel}</td>
        </tr>
        ${deliveryAddr ? `
        <tr>
          <td style="padding:5px 0;color:#6b7280">Location</td>
          <td style="padding:5px 0;color:#111827">${deliveryAddr}</td>
        </tr>` : ''}
        ${delivery.instructions ? `
        <tr>
          <td style="padding:5px 0;color:#6b7280">Notes</td>
          <td style="padding:5px 0;color:#111827">${delivery.instructions}</td>
        </tr>` : ''}
      </table>
    </td></tr>` : ''}

    <!-- Next steps -->
    <tr><td style="background:#ffffff;padding:24px 36px">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">What Happens Next</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${[
          ['📦', 'We are processing your order', 'Our team is preparing your items for dispatch.'],
          ['🚚', 'Delivery notification', "You'll receive an email with dispatch details when your order ships."],
          ['📱', 'Track your order', 'Check your order status anytime from your account dashboard.'],
        ].map(([icon, title, sub]) => `
        <tr>
          <td style="vertical-align:top;padding:8px 12px 8px 0;width:36px;font-size:22px">${icon}</td>
          <td style="padding:8px 0">
            <p style="margin:0;font-size:13px;font-weight:600;color:#111827">${title}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#6b7280">${sub}</p>
          </td>
        </tr>`).join('')}
      </table>
    </td></tr>

    <!-- CTA buttons -->
    <tr><td style="background:#ffffff;padding:0 36px 32px;text-align:center">
      <a href="${env.FRONTEND_URL}/account/orders"
         style="display:inline-block;padding:13px 28px;background:#1a3828;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;margin:4px">
        Track My Order →
      </a>
      <a href="${waLink}?text=${waText}"
         style="display:inline-block;padding:13px 28px;background:#25D366;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;margin:4px">
        💬 WhatsApp Us
      </a>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 16px 16px;padding:24px 36px;text-align:center">
      <p style="margin:0 0 6px;font-size:13px;color:#374151;font-weight:600">Need help with your order?</p>
      <p style="margin:0 0 12px;font-size:12px;color:#9ca3af">
        Chat with us on WhatsApp:
        <a href="${waLink}" style="color:#25D366;text-decoration:none;font-weight:600">0757 568 845</a>
        · or reply to this email
      </p>
      <p style="margin:0;font-size:11px;color:#9ca3af">
        © ${new Date().getFullYear()} MeAndMine.shop · Quality Home Goods, Kenya<br/>
        Order ref: <strong>${orderNumber}</strong>
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`,
      text: `🎉 Order Confirmed — ${orderNumber}\n\nHi ${customerName || 'there'},\n\nYour payment has been received and your order is confirmed!\n\nItems:\n${items.map((i) => `  • ${i.name} × ${i.quantity}  —  ${fmt(i.price * i.quantity)}`).join('\n')}\n\nTotal Paid: ${fmt(total)}\n\n${delivery ? `Delivery: ${deliveryLabel}\nAddress: ${deliveryAddr}\n` : ''}Track your order: ${env.FRONTEND_URL}/account/orders\n\nFor enquiries, WhatsApp us: 0757 568 845`,
    };
  },

  adminOrderNotification: (
    orderNumber: string,
    total: number,
    customerName: string,
    customerEmail: string,
    customerPhone: string,
    items: { name: string; quantity: number; price: number }[],
    delivery?: {
      recipientName?: string;
      phone?: string;
      county?: string;
      town?: string;
      stage?: string;
      deliveryMethod?: string;
      instructions?: string;
    },
    discount?: number,
  ) => {
    const fmt = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const deliveryLabel = delivery?.deliveryMethod === 'pickup' ? 'Self Pickup' : 'Home Delivery';
    const deliveryAddr = delivery
      ? [delivery.town, delivery.county, delivery.stage].filter(Boolean).join(', ')
      : '';
    const waLink = `https://wa.me/${(customerPhone || '').replace(/[^0-9]/g, '').replace(/^0/, '254')}`;
    const dateStr = new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    return {
      subject: `🛍️ New Order ${orderNumber} — ${fmt(total)}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

    <!-- Header -->
    <tr><td style="background:linear-gradient(135deg,#1a3828 0%,#2d5016 100%);border-radius:16px 16px 0 0;padding:28px 36px">
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#a3c4a8">MeAndMine Admin</p>
      <h1 style="margin:8px 0 4px;font-size:22px;font-weight:800;color:#ffffff">🛍️ New Order Received</h1>
      <p style="margin:0;font-size:13px;color:#a3c4a8">${orderNumber} · ${dateStr}</p>
    </td></tr>

    <!-- Customer info -->
    <tr><td style="background:#ffffff;padding:24px 36px;border-bottom:1px solid #f3f4f6">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">Customer</p>
      <table cellpadding="0" cellspacing="0" style="font-size:13px">
        <tr><td style="padding:3px 0;color:#6b7280;width:100px">Name</td><td style="padding:3px 0;color:#111827;font-weight:600">${customerName || '—'}</td></tr>
        <tr><td style="padding:3px 0;color:#6b7280">Email</td><td style="padding:3px 0"><a href="mailto:${customerEmail}" style="color:#1a3828">${customerEmail}</a></td></tr>
        <tr><td style="padding:3px 0;color:#6b7280">Phone</td><td style="padding:3px 0;color:#111827">${customerPhone || delivery?.phone || '—'}</td></tr>
      </table>
      ${customerPhone || delivery?.phone ? `
      <a href="${waLink}"
         style="display:inline-block;margin-top:12px;padding:8px 20px;background:#25D366;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px">
        💬 WhatsApp Customer
      </a>` : ''}
    </td></tr>

    <!-- Items -->
    <tr><td style="background:#ffffff;padding:24px 36px 0">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">Items Ordered</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
        <tr style="background:#f9fafb">
          <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600">Product</th>
          <th style="text-align:center;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600">Qty</th>
          <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#374151;font-weight:600">Amount</th>
        </tr>
        ${items.map((i, idx) => `
        <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#fafafa'}">
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#111827">${i.name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;color:#374151">${i.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#111827">${fmt(i.price * i.quantity)}</td>
        </tr>`).join('')}
        ${discount && discount > 0 ? `
        <tr>
          <td colspan="2" style="padding:8px 12px;color:#15803d;font-size:12px">Discount</td>
          <td style="padding:8px 12px;text-align:right;color:#15803d">− ${fmt(discount)}</td>
        </tr>` : ''}
        <tr style="background:#1a3828">
          <td colspan="2" style="padding:12px;font-weight:700;color:#ffffff">Total Paid</td>
          <td style="padding:12px;font-weight:800;font-size:15px;color:#c47b2a;text-align:right">${fmt(total)}</td>
        </tr>
      </table>
    </td></tr>

    <!-- Delivery -->
    ${delivery ? `
    <tr><td style="background:#ffffff;padding:24px 36px">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280">Delivery Details</p>
      <table cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px;font-size:13px;width:100%">
        <tr><td style="padding:4px 0;color:#6b7280;width:120px">Method</td><td style="padding:4px 0;color:#111827;font-weight:600">${deliveryLabel}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Recipient</td><td style="padding:4px 0;color:#111827">${delivery.recipientName || customerName}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Phone</td><td style="padding:4px 0;color:#111827">${delivery.phone || '—'}</td></tr>
        ${deliveryAddr ? `<tr><td style="padding:4px 0;color:#6b7280">Location</td><td style="padding:4px 0;color:#111827">${deliveryAddr}</td></tr>` : ''}
        ${delivery.instructions ? `<tr><td style="padding:4px 0;color:#6b7280">Notes</td><td style="padding:4px 0;color:#111827">${delivery.instructions}</td></tr>` : ''}
      </table>
    </td></tr>` : ''}

    <!-- Action button -->
    <tr><td style="background:#ffffff;padding:0 36px 32px;text-align:center">
      <a href="${env.FRONTEND_URL}/admin/orders"
         style="display:inline-block;padding:12px 28px;background:#1a3828;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">
        View in Admin Dashboard →
      </a>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center">
      <p style="margin:0;font-size:11px;color:#9ca3af">MeAndMine.shop Admin Notification · Order ${orderNumber}</p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`,
      text: `New Order ${orderNumber}\n\nCustomer: ${customerName} (${customerEmail})\nPhone: ${customerPhone || delivery?.phone || '—'}\n\nItems:\n${items.map((i) => `  • ${i.name} × ${i.quantity}  —  ${fmt(i.price * i.quantity)}`).join('\n')}\n\nTotal: ${fmt(total)}\nDelivery: ${deliveryLabel} · ${deliveryAddr}\n\nView order: ${env.FRONTEND_URL}/admin/orders`,
    };
  },

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
