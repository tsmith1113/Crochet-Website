import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { Resend } from 'resend';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import path from 'path';
import {
  initializeCustomerFeatureSchema,
  registerCustomerFeatureRoutes
} from './customer-features.js';

dotenv.config();

let JWT_SECRET;
let customerFeatures;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please try again in 15 minutes.' }
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many accounts created. Please try again in an hour.' }
});

const orderLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many lookup attempts. Please try again in 15 minutes.' }
});

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(cookieParser());
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  if (!stripeSecretKey) {
    console.error('Stripe secret key not configured');
    return res.status(503).send('Stripe secret key not configured');
  }
  if (!stripeWebhookSecret) {
    console.error('Stripe webhook secret not configured');
    return res.status(500).send('Stripe webhook secret not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const orderId = Number(session.metadata?.orderId);
    if (orderId && session.payment_status === 'paid') {
      try {
        const orderRow = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orderRow) {
          const wasPending = orderRow.status === 'payment_pending';
          const paymentIntentId = typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id || null;
          await runAsync(
            `UPDATE orders SET status = 'confirmed', payment_intent_id = ?,
             total = ?, updated_at = ? WHERE id = ?`,
            [paymentIntentId, Number(session.amount_total || 0) / 100, new Date().toISOString(), orderId]
          );
          await customerFeatures.handlePaidOrder(
            { ...orderRow, status: 'confirmed', total: Number(session.amount_total || 0) / 100 },
            session
          );
          if (wasPending) {
            const order = parseOrderRow({ ...orderRow, status: 'confirmed', total: Number(session.amount_total || 0) / 100 });
            await sendOrderConfirmationEmail(order);
            sendOwnerNotificationEmail(order).catch(err => console.error('Owner notification failed:', err));
          }
        }
      } catch (err) {
        console.error('Error processing webhook order:', err);
        return res.status(500).json({ error: 'Unable to process paid order.' });
      }
    }
  }

  if (event.type === 'charge.refunded') {
    try {
      await customerFeatures.handleRefund(event.data.object, event.id);
    } catch (err) {
      console.error('Unable to reverse refunded order points:', err);
      return res.status(500).json({ error: 'Unable to process refund.' });
    }
  }

  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    try {
      await customerFeatures.releaseCheckout(event.data.object);
      const orderId = Number(event.data.object.metadata?.orderId);
      if (orderId) {
        await runAsync(
          `UPDATE orders SET status = 'checkout_expired', updated_at = ?
           WHERE id = ? AND status = 'payment_pending'`,
          [new Date().toISOString(), orderId]
        );
      }
    } catch (err) {
      console.error('Unable to release expired checkout:', err);
      return res.status(500).json({ error: 'Unable to release expired checkout.' });
    }
  }

  res.json({ received: true });
});
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim() || '';
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || '';
const resendApiKey = process.env.RESEND_API_KEY?.trim() || '';

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2026-05-27.dahlia'
}) : null;
const resend = new Resend(resendApiKey);

const WEEKLY_ORDER_LIMIT = Number(process.env.WEEKLY_ORDER_LIMIT || 20);
const STRIPE_PRICE_IDS = {
  Beanie: 'price_1Tf0rJK7MUFGeMDDFHsxUiZu',
  'Bucket Hat': 'price_1Tf0rJK7MUFGeMDD1U4BIDsU',
  'Ruffle Bucket Hat': 'price_1Tf0rJK7MUFGeMDDuwZ8kjHG',
  Scrunchie: 'price_1Tf0rJK7MUFGeMDDXDu3iMZr'
};
const PRODUCT_PRICES_CENTS = {
  Beanie: 2500,
  'Bucket Hat': 2500,
  'Ruffle Bucket Hat': 3500,
  Scrunchie: 800
};

function normalizeCheckoutItems(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) return null;
  const items = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || !PRODUCT_PRICES_CENTS[item.product]) return null;
    if (item.isReadyToShip === true) {
      const inventoryId = Number(item.inventoryId);
      if (!Number.isInteger(inventoryId) || inventoryId <= 0 ||
          !['Beanie', 'Bucket Hat', 'Ruffle Bucket Hat'].includes(item.product)) return null;
      items.push({ product: item.product, inventoryId, isReadyToShip: true, colors: [] });
      continue;
    }
    if (!Array.isArray(item.colors) || item.colors.length < 1 || item.colors.length > 3 ||
        item.colors.some(color => typeof color !== 'string' || !/^[A-Za-z][A-Za-z -]{0,29}$/.test(color))) return null;
    const product = item.product;
    const rowCount = product === 'Scrunchie' ? Number(item.rowCount || 1) : 1;
    if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 3) return null;
    const bucketHatStyle = product === 'Ruffle Bucket Hat'
      ? (item.bucketHatStyle === 'main-rest' ? 'main-rest' : item.bucketHatStyle === 'main-outer-top' ? 'main-outer-top' : '')
      : '';
    if (product === 'Ruffle Bucket Hat' && !bucketHatStyle) return null;
    const baseColorCount = product === 'Ruffle Bucket Hat'
      ? (bucketHatStyle === 'main-rest' ? 2 : 3)
      : product === 'Scrunchie' ? rowCount : 1;
    if (item.colors.length !== baseColorCount) return null;
    const allOneColor = item.allOneColor === true;
    if (allOneColor && !item.colors.every(color => color === item.colors[0])) return null;
    const hasExtraColor = product === 'Ruffle Bucket Hat' &&
      bucketHatStyle === 'main-outer-top' && !allOneColor;
    if (item.headCircumference && !/^\d{1,2}(?:\.\d{1,2})?$/.test(String(item.headCircumference))) return null;
    if (item.size && !/^[A-Za-z0-9 -]{1,30}$/.test(String(item.size))) return null;
    const priceCents = PRODUCT_PRICES_CENTS[product] + (hasExtraColor ? 200 : 0);
    items.push({
      product,
      colors: item.colors,
      headCircumference: item.headCircumference ? String(item.headCircumference) : '',
      size: item.size ? String(item.size) : '',
      allOneColor,
      bucketHatStyle,
      rowCount,
      price: priceCents / 100
    });
  }
  return items;
}

function buildCheckoutLineItems(items, shipping, deliveryMethod, inventory, bogoInventoryId = null) {
  const quantities = new Map();
  const inventoryQuantities = new Map();
  for (const item of items) {
    if (item.isReadyToShip) {
      inventoryQuantities.set(item.inventoryId, (inventoryQuantities.get(item.inventoryId) || 0) + 1);
    } else {
      quantities.set(item.product, (quantities.get(item.product) || 0) + 1);
    }
  }
  const lineItems = Array.from(quantities, ([product, quantity]) => ({
    price: STRIPE_PRICE_IDS[product],
    quantity
  }));
  let totalCents = items.reduce((sum, item) => sum + (item.isReadyToShip ? 0 : Math.round(item.price * 100)), 0);
  for (const [inventoryId, quantity] of inventoryQuantities) {
    const inventoryItem = inventory.get(inventoryId);
    const chargedQuantity = Math.max(0, quantity - (inventoryId === bogoInventoryId ? 1 : 0));
    if (!inventoryItem || chargedQuantity < 1) continue;
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: `${inventoryItem.name} (Ready-to-Ship)` },
        unit_amount: inventoryItem.price_cents
      },
      quantity: chargedQuantity
    });
    totalCents += inventoryItem.price_cents * chargedQuantity;
  }
  const extraColorCount = items.filter(item => item.product === 'Ruffle Bucket Hat' && item.price > 35).length;
  if (extraColorCount) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Extra Color Surcharge' },
        unit_amount: 200
      },
      quantity: extraColorCount
    });
  }
  const shippingCents = deliveryMethod === 'ksu' ? 500 : shipping === 'express' ? 1200 : 500;
  const shippingLabel = deliveryMethod === 'ksu'
    ? 'KSU Campus Delivery'
    : shipping === 'express' ? 'Express Shipping (2–3 days)' : 'Standard Shipping (5–7 days)';
  lineItems.push({
    price_data: {
      currency: 'usd',
      product_data: { name: shippingLabel },
      unit_amount: shippingCents
    },
    quantity: 1
  });
  return {
    lineItems,
    totalCents: totalCents + shippingCents,
    inventoryQuantities
  };
}

function getWeekStartISOString() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7; // Monday as week start
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart.toISOString();
}

async function isWeeklyOrderLimitReached() {
  if (!WEEKLY_ORDER_LIMIT || WEEKLY_ORDER_LIMIT <= 0) {
    return false;
  }
  const weekStart = getWeekStartISOString();
  const row = await getAsync('SELECT COUNT(*) AS count FROM orders WHERE created_at >= ?', [weekStart]);
  return row?.count >= WEEKLY_ORDER_LIMIT;
}

const dbPath = process.env.DB_PATH || '/var/data/orders.db';
const uploadDirectory = path.resolve(
  process.env.REVIEW_UPLOAD_DIR || path.join(path.dirname(dbPath), '.review-uploads')
);
const db = new sqlite3.Database(dbPath, err => {
  if (err) {
    console.error('Unable to open orders.db', err);
    process.exit(1);
  }
});
db.configure('busyTimeout', 10000);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE,
      full_name TEXT,
      email TEXT,
      street TEXT,
      city TEXT,
      state TEXT,
      postal TEXT,
      shipping TEXT,
      shipping_cost REAL,
      total REAL,
      status TEXT,
      tracking_number TEXT,
      items TEXT,
      created_at TEXT,
      updated_at TEXT,
      stripe_session_id TEXT,
      delivery_method TEXT DEFAULT 'ship',
      ksu_campus TEXT,
      ksu_meetup_location TEXT,
      ksu_delivery_day TEXT,
      ksu_delivery_time TEXT,
      ksu_phone TEXT,
      ksu_id_number TEXT,
      missed_delivery_count INTEGER DEFAULT 0,
      pending_reschedule_day TEXT,
      pending_reschedule_time TEXT,
      pending_reschedule_session_id TEXT
    )
  `);
  // Backfill columns for databases created before campus delivery existed.
  db.run(`ALTER TABLE orders ADD COLUMN delivery_method TEXT DEFAULT 'ship'`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN ksu_campus TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN ksu_meetup_location TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN ksu_delivery_day TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN ksu_delivery_time TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN ksu_phone TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN ksu_id_number TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN missed_delivery_count INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN pending_reschedule_day TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN pending_reschedule_time TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN pending_reschedule_session_id TEXT`, () => {});
  db.run(`ALTER TABLE orders ADD COLUMN delivered_at TEXT`, () => {});
});


db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    street TEXT,
    city TEXT,
    state TEXT,
    postal TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`, () => {});
db.run(`ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1`, () => {});
db.run(`ALTER TABLE users ADD COLUMN verification_token TEXT`, () => {});
db.run(`CREATE TABLE IF NOT EXISTS app_secrets (key TEXT PRIMARY KEY, value TEXT)`, (err) => {
  if (err) console.error('Failed to create app_secrets table:', err);
  else startServer();
});

const runAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const allAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

const getAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  });
});

const transactionAsync = async callback => {
  const transactionDb = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(dbPath, error => {
      if (error) reject(error);
      else resolve(connection);
    });
  });
  transactionDb.configure('busyTimeout', 10000);
  const transactionRun = (sql, params = []) => new Promise((resolve, reject) => {
    transactionDb.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
  const transactionGet = (sql, params = []) => new Promise((resolve, reject) => {
    transactionDb.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row);
    });
  });
  const transactionAll = (sql, params = []) => new Promise((resolve, reject) => {
    transactionDb.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows);
    });
  });

  try {
    await transactionRun('BEGIN IMMEDIATE');
    const result = await callback({
      runAsync: transactionRun,
      getAsync: transactionGet,
      allAsync: transactionAll
    });
    await transactionRun('COMMIT');
    return result;
  } catch (error) {
    await transactionRun('ROLLBACK').catch(rollbackError => {
      console.error('Unable to roll back SQLite transaction:', rollbackError);
    });
    throw error;
  } finally {
    await new Promise((resolve, reject) => {
      transactionDb.close(error => error ? reject(error) : resolve());
    });
  }
};

async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not logged in' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getAsync('SELECT * FROM users WHERE id = ?', [decoded.userId]);

    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function parseOrderRow(row) {
  if (!row) return null;
  return {
    ...row,
    items: row.items ? JSON.parse(row.items) : []
  };
}

function createOrderNumber() {
  return `ORD-${Date.now()}`;
}

// Order production pipeline. `confirmed` is set by the order/webhook routes and
// `shipped` is set by /orders/:id/ship — both stay on their existing dedicated
// routes. This list is only the statuses settable via PATCH /orders/:id/status.
const ORDER_STATUS_STEPS = [
  { key: 'confirmed', label: 'Order Confirmed', description: 'Payment received' },
  { key: 'preparing', label: 'Preparing Your Order', description: 'Materials and details confirmed' },
  { key: 'making', label: 'Making Your Hat', description: 'Your handmade item is being crocheted' },
  { key: 'ready', label: 'Ready to Ship', description: 'Order packaged and ready' },
  { key: 'shipped', label: 'Shipped', description: 'Your package is on the way' },
  { key: 'delivered', label: 'Delivered', description: 'Your order has arrived' }
];
const ADVANCEABLE_ORDER_STATUSES = ORDER_STATUS_STEPS
  .map(step => step.key)
  .filter(key => key !== 'confirmed' && key !== 'shipped');

function getItemPrice(item) {
  return Number(item.price || 0);
}

function isValidKsuId(value) {
  return typeof value === 'string' && /^00\d{7}$/.test(value.trim());
}

function isValidKsuDeliveryTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(value.trim());
  if (!match) return false;
  let hour = Number(match[1]) % 12;
  if (match[3] === 'PM') hour += 12;
  const minutes = Number(match[2]);
  return hour < 18 || (hour === 18 && minutes === 0);
}

const KSU_LATE_FEE_AMOUNT = 10;
const KSU_GRACE_PERIOD_MINUTES = 10;

async function findOrderByNumberAndLastName(orderNumber, lastName) {
  if (!orderNumber || !lastName) return null;
  const order = await getAsync('SELECT * FROM orders WHERE order_number = ?', [orderNumber.trim()]);
  if (!order) return null;
  const nameParts = (order.full_name || '').trim().split(' ');
  const storedLastName = nameParts[nameParts.length - 1].toLowerCase();
  if (storedLastName !== lastName.trim().toLowerCase()) return null;
  return order;
}

function getItemColorLabels(product, bucketHatStyle, rowCount) {
  if (product === 'Ruffle Bucket Hat') {
    return bucketHatStyle === 'main-rest'
      ? ['Main Color', 'Rest of Hat']
      : ['Main Color', 'Outer Color', 'Top Color'];
  }
  if (product === 'Scrunchie') {
    if (rowCount === 2) return ['Outer Row Color', 'Rest of Scrunchie Color'];
    if (rowCount === 3) return ['Outer Row Color', 'Middle Row Color', 'Inner Row Color'];
    return ['Row Color'];
  }
  return ['Color'];
}

function buildOrderConfirmationEmail(order) {
  const itemsHtml = order.items.map((item, index) => {
    const details = [];
    if (item.colors?.length) {
      const labels = getItemColorLabels(item.product, item.bucketHatStyle, item.rowCount);
      const colorStr = item.colors.map((c, i) => `${labels[i] || 'Color'}: ${c}`).join(', ');
      details.push(`<strong>Colors:</strong> ${colorStr}`);
    }
    if (item.bucketHatStyle) details.push(`<strong>Style:</strong> ${item.bucketHatStyle.replace(/-/g, ' ')}`);
    if (item.headCircumference) details.push(`<strong>Head circumference:</strong> ${item.headCircumference}"`);
    if (item.size) details.push(`<strong>Size:</strong> ${item.size}`);
    if (item.rowCount && item.rowCount > 1) details.push(`<strong>Rows:</strong> ${item.rowCount}`);
    if (item.allOneColor) details.push('<strong>All one color</strong>');
    return `
      <tr style="border-bottom:1px solid #e8dff0;">
        <td style="padding:12px 10px;color:#555;">${index + 1}</td>
        <td style="padding:12px 10px;">
          <strong style="color:#5a3e6b;">${item.product}</strong><br>
          <span style="font-size:13px;color:#666;">${details.join('<br>')}</span>
        </td>
        <td style="padding:12px 10px;text-align:right;font-weight:600;">$${getItemPrice(item).toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  const isKsuDelivery = order.delivery_method === 'ksu';
  const shippingLabel = isKsuDelivery
    ? 'KSU Campus Delivery'
    : (order.shipping === 'express' ? 'Express (2–3 days)' : 'Standard (5–7 days)');

  const deliveryToHtml = isKsuDelivery
    ? `
          <h3 style="color:#5a3e6b;margin:24px 0 8px;font-size:16px;">Campus Delivery Details</h3>
          <p style="color:#555;margin:0;line-height:1.6;">
            ${order.full_name}<br>
            Campus: ${order.ksu_campus || '—'}<br>
            Meetup Location: ${order.ksu_meetup_location || '—'}<br>
            Preferred Delivery Day: ${order.ksu_delivery_day || '—'}<br>
            Preferred Delivery Time: ${order.ksu_delivery_time || '—'} (no later than 6:00 PM)<br>
            Phone: ${order.ksu_phone || '—'}<br>
            KSU ID: ${order.ksu_id_number || '—'}
          </p>
          <p style="margin:12px 0 0;color:#666;font-size:14px;">We'll reach out to confirm the exact meetup time once your order is ready — no need to share a dorm or room number.</p>
          <p style="margin:8px 0 0;color:#b00020;font-size:13px;">⏰ There's a 10-minute grace period for your delivery time. If you're more than 10 minutes late, a $10 late fee applies and you'll need to <a href="${process.env.SITE_URL || 'http://localhost:3000'}/missed-delivery" style="color:#b00020;">reschedule your delivery here</a>.</p>
    `
    : `
          <h3 style="color:#5a3e6b;margin:24px 0 8px;font-size:16px;">Shipping To</h3>
          <p style="color:#555;margin:0;line-height:1.6;">
            ${order.full_name}<br>
            ${order.street}<br>
            ${order.city}, ${order.state} ${order.postal}
          </p>
    `;

  const processingNote = isKsuDelivery
    ? `Please allow <strong>3–5 business days</strong> for processing before your order is ready. We'll email or text you to confirm your campus meetup time.`
    : `Please allow <strong>3–5 business days</strong> for processing before your order ships. You'll receive a separate email with your tracking number once it's on the way.`;

  return `
    <div style="font-family:Georgia,serif;background:#faf6f2;padding:30px 0;">
      <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07);">

        <div style="background:#9b6ea8;padding:28px 32px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:1px;">🧶 Stitched By Trae</h1>
          <p style="color:#f3eaf8;margin:6px 0 0;font-size:14px;">Handmade with love</p>
        </div>

        <div style="padding:28px 32px;">
          <h2 style="color:#5a3e6b;margin:0 0 6px;">Thank you for your order!</h2>
          <p style="color:#666;margin:0 0 20px;">Your order has been received and is being handcrafted just for you.</p>

          <div style="background:#f3eaf8;border-radius:8px;padding:14px 18px;margin-bottom:24px;">
            <p style="margin:0;font-size:14px;color:#5a3e6b;"><strong>Order Number:</strong> ${order.order_number}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#888;">Please save this for your records.</p>
          </div>

          <h3 style="color:#5a3e6b;margin:0 0 12px;font-size:16px;">Your Items</h3>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e8dff0;border-radius:8px;overflow:hidden;">
            <thead>
              <tr style="background:#f3eaf8;">
                <th style="padding:10px;text-align:left;font-size:13px;color:#5a3e6b;">#</th>
                <th style="padding:10px;text-align:left;font-size:13px;color:#5a3e6b;">Item</th>
                <th style="padding:10px;text-align:right;font-size:13px;color:#5a3e6b;">Price</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>

          <table style="width:100%;margin-top:16px;">
            <tr>
              <td style="padding:6px 0;color:#666;font-size:14px;">${isKsuDelivery ? shippingLabel : `Shipping (${shippingLabel})`}</td>
              <td style="padding:6px 0;text-align:right;color:#666;font-size:14px;">$${Number(order.shipping_cost).toFixed(2)}</td>
            </tr>
            <tr style="border-top:2px solid #e8dff0;">
              <td style="padding:10px 0 0;font-size:16px;font-weight:700;color:#5a3e6b;">Total</td>
              <td style="padding:10px 0 0;text-align:right;font-size:16px;font-weight:700;color:#5a3e6b;">$${Number(order.total).toFixed(2)}</td>
            </tr>
          </table>

          ${deliveryToHtml}

          <p style="margin:24px 0 0;color:#666;font-size:14px;">${processingNote}</p>
        </div>

        <div style="background:#f3eaf8;padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:13px;color:#888;">Questions? Email us at <a href="mailto:stitchedbytrae@gmail.com" style="color:#9b6ea8;">stitchedbytrae@gmail.com</a></p>
          <p style="margin:6px 0 0;font-size:12px;color:#bbb;">© 2026 Stitched By Trae</p>
        </div>

      </div>
    </div>
  `;
}

async function sendOrderConfirmationEmail(order) {
  return resend.emails.send({
    from: 'orders@stitchedbytrae.com',
    replyTo: 'stitchedbytrae@gmail.com',
    to: order.email,
    subject: `Order Confirmation #${order.order_number}`,
    html: buildOrderConfirmationEmail(order)
  });
}

async function sendOwnerNotificationEmail(order) {
  const ownerEmail = process.env.OWNER_EMAIL || 'stitchedbytrae@gmail.com';
  const itemsHtml = order.items.map((item, i) => {
    const labels = getItemColorLabels(item.product, item.bucketHatStyle, item.rowCount);
    const colorStr = (item.colors || []).map((c, idx) => `${labels[idx] || 'Color'}: ${c}`).join(', ') || '—';
    const detail = [item.headCircumference ? `Head: ${item.headCircumference}"` : '', item.size || ''].filter(Boolean).join(', ') || '—';
    return `
    <tr>
      <td style="padding:6px 10px;">${i + 1}</td>
      <td style="padding:6px 10px;">${item.product}</td>
      <td style="padding:6px 10px;">${colorStr}</td>
      <td style="padding:6px 10px;">${detail}</td>
      <td style="padding:6px 10px;">$${getItemPrice(item)}</td>
    </tr>
  `;
  }).join('');

  const isKsuDelivery = order.delivery_method === 'ksu';
  const deliveryHtml = isKsuDelivery
    ? `
      <h3 style="margin-top:1.5rem;color:#b00020;">🎓 KSU Campus Delivery — do not mail this order!</h3>
      <p>
        Campus: ${order.ksu_campus || '—'}<br>
        Meetup Location: ${order.ksu_meetup_location || '—'}<br>
        Preferred Delivery Day: ${order.ksu_delivery_day || '—'}<br>
        Preferred Delivery Time: ${order.ksu_delivery_time || '—'}<br>
        Phone: ${order.ksu_phone || '—'}<br>
        KSU ID: ${order.ksu_id_number || '—'}
      </p>
    `
    : `
      <h3 style="margin-top:1.5rem;">Ship To</h3>
      <p>${order.street}<br>${order.city}, ${order.state} ${order.postal}</p>
    `;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#9b6ea8;">🧶 New Order Received!</h2>
      <p><strong>Order #:</strong> ${order.order_number}</p>
      <p><strong>Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
      <p><strong>Delivery Method:</strong> ${isKsuDelivery ? 'KSU Campus Delivery' : 'Ship My Order'}</p>

      <h3 style="margin-top:1.5rem;">Customer</h3>
      <p>${order.full_name}<br>${order.email}</p>

      ${deliveryHtml}

      <h3 style="margin-top:1.5rem;">Items</h3>
      <table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead style="background:#f3eaf8;">
          <tr>
            <th style="padding:6px 10px;">#</th>
            <th style="padding:6px 10px;">Product</th>
            <th style="padding:6px 10px;">Colors</th>
            <th style="padding:6px 10px;">Details</th>
            <th style="padding:6px 10px;">Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <p style="margin-top:1rem;"><strong>${isKsuDelivery ? 'Delivery Fee' : 'Shipping'}:</strong> ${isKsuDelivery ? 'KSU Campus Delivery' : order.shipping} — $${order.shipping_cost}</p>
      <p><strong>Total Charged:</strong> $${order.total}</p>
    </div>
  `;

  return resend.emails.send({
    from: 'orders@stitchedbytrae.com',
    to: ownerEmail,
    subject: `New Order #${order.order_number} from ${order.full_name}`,
    html
  });
}

async function sendShippingEmail(order, trackingNumber) {
  return resend.emails.send({
    from: 'orders@stitchedbytrae.com',
    replyTo: 'stitchedbytrae@gmail.com',
    to: order.email,
    subject: `📦 Your order #${order.order_number} has shipped!`,
    html: `
      <h1>Your order is on the way!</h1>
      <p>Your tracking number is:</p>
      <h2>${trackingNumber}</h2>
      <p>Thank you for shopping with Stitched By Trae!</p>
    `
  });
}

function getOrderItemsSummary(order) {
  return (order.items || []).map(item => item.product).join(', ') || 'your order';
}

async function sendProductionStartedEmail(order) {
  return resend.emails.send({
    from: 'orders@stitchedbytrae.com',
    replyTo: 'stitchedbytrae@gmail.com',
    to: order.email,
    subject: `🧶 We've started making your order #${order.order_number}!`,
    html: `
      <div style="font-family:Georgia,serif;background:#faf6f2;padding:30px 0;">
        <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07);">
          <div style="background:#9b6ea8;padding:28px 32px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:1px;">🧶 Stitched By Trae</h1>
            <p style="color:#f3eaf8;margin:6px 0 0;font-size:14px;">Handmade with love</p>
          </div>
          <div style="padding:28px 32px;">
            <h2 style="color:#5a3e6b;margin:0 0 6px;">Your hat is being made!</h2>
            <p style="color:#555;line-height:1.6;">Good news — we've started crocheting <strong>${getOrderItemsSummary(order)}</strong> for order <strong>#${order.order_number}</strong>. We'll let you know as soon as it's ready to ship.</p>
          </div>
          <div style="background:#f3eaf8;padding:20px 32px;text-align:center;">
            <p style="margin:0;font-size:13px;color:#888;">Questions? Email us at <a href="mailto:stitchedbytrae@gmail.com" style="color:#9b6ea8;">stitchedbytrae@gmail.com</a></p>
            <p style="margin:6px 0 0;font-size:12px;color:#bbb;">© 2026 Stitched By Trae</p>
          </div>
        </div>
      </div>
    `
  });
}

async function sendDeliveryConfirmationEmail(order) {
  return resend.emails.send({
    from: 'orders@stitchedbytrae.com',
    replyTo: 'stitchedbytrae@gmail.com',
    to: order.email,
    subject: `💜 Your order #${order.order_number} has arrived!`,
    html: `
      <div style="font-family:Georgia,serif;background:#faf6f2;padding:30px 0;">
        <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.07);">
          <div style="background:#9b6ea8;padding:28px 32px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:1px;">🧶 Stitched By Trae</h1>
            <p style="color:#f3eaf8;margin:6px 0 0;font-size:14px;">Handmade with love</p>
          </div>
          <div style="padding:28px 32px;">
            <h2 style="color:#5a3e6b;margin:0 0 6px;">Your order has arrived! 💜</h2>
            <p style="color:#555;line-height:1.6;">We hope you love <strong>${getOrderItemsSummary(order)}</strong> from order <strong>#${order.order_number}</strong> as much as we loved making it. Thank you for supporting a small handmade shop!</p>
          </div>
          <div style="background:#f3eaf8;padding:20px 32px;text-align:center;">
            <p style="margin:0;font-size:13px;color:#888;">Questions? Email us at <a href="mailto:stitchedbytrae@gmail.com" style="color:#9b6ea8;">stitchedbytrae@gmail.com</a></p>
            <p style="margin:6px 0 0;font-size:12px;color:#bbb;">© 2026 Stitched By Trae</p>
          </div>
        </div>
      </div>
    `
  });
}

async function sendVerificationEmail(email, name, token) {
  const origin = process.env.SITE_URL || 'http://localhost:3000';
  return resend.emails.send({
    from: 'orders@stitchedbytrae.com',
    replyTo: 'stitchedbytrae@gmail.com',
    to: email,
    subject: 'Verify your Stitched By Trae account',
    html: `
      <h2>Welcome to Stitched By Trae! 🧶</h2>
      <p>Hi ${name},</p>
      <p>Thanks for creating an account! Please click the link below to verify your email address.</p>
      <p><a href="${origin}/verify-email?token=${token}" style="background:#9b6ea8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0;">Verify My Email</a></p>
      <p>If you did not create an account, you can safely ignore this email.</p>
    `
  });
}

function isPasswordStrong(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

app.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!isPasswordStrong(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character.' });
    }

    const existing = await getAsync('SELECT * FROM users WHERE email = ?', [email]);

    if (existing) {
      if (!existing.email_verified) {
        const newToken = crypto.randomBytes(32).toString('hex');
        await runAsync('UPDATE users SET verification_token = ? WHERE id = ?', [newToken, existing.id]);
        try { await sendVerificationEmail(email, existing.name, newToken); } catch (e) { console.error('Resend error:', e); }
        return res.json({ success: true, message: 'A verification email has been resent. Please check your inbox.' });
      }
      return res.status(400).json({ error: 'An account with that email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const insertedUser = await transactionAsync(async ({ runAsync: txRun }) => {
      const result = await txRun(
        'INSERT INTO users (name, email, password, email_verified, verification_token) VALUES (?, ?, ?, 0, ?)',
        [name, email, hashedPassword, verificationToken]
      );
      await txRun(
        `INSERT INTO rewards_ledger (user_id, points, activity, event_key, created_at)
         VALUES (?, 50, 'Created an account', ?, ?)`,
        [result.lastID, `signup:${result.lastID}`, new Date().toISOString()]
      );
      return result;
    });

    try { await sendVerificationEmail(email, name, verificationToken); } catch (e) { console.error('Resend error:', e); }

    res.json({ success: true, message: 'Account created! Please check your email to verify your account before logging in.' });
  } catch (err) {
    console.error('Signup error:', err.message, err.stack);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/verify-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login?error=invalid');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Email - Stitched By Trae</title>
  <link rel="stylesheet" href="/css/site.css">
</head>
<body>
<div class="auth-container"><div class="auth-card">
  <h1>🧶 Verify Your Email</h1>
  <p>Click the button below to verify your email address and activate your account.</p>
  <form id="verify-form" method="POST" action="/verify-email">
    <input type="hidden" name="token" value="${token}">
    <button type="submit" class="button">Verify My Email</button>
  </form>
  <script>document.getElementById('verify-form').submit();</script>
</div></div>
</body>
</html>`);
});

app.post('/verify-email', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.redirect('/login?error=invalid');
  try {
    const user = await getAsync('SELECT * FROM users WHERE verification_token = ?', [token]);
    if (!user) return res.redirect('/login?error=invalid');
    await runAsync(
      'UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?',
      [user.id]
    );
    res.redirect('/login?verified=1');
  } catch (err) {
    console.error(err);
    res.redirect('/login?error=invalid');
  }
});

app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    const user = await getAsync(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password
    );

    if (!validPassword) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    if (!user.email_verified) {
      return res.status(401).json({
        error: 'Please verify your email before logging in. Check your inbox for a verification link.'
      });
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && user.email.toLowerCase() === adminEmail.toLowerCase() && !user.is_admin) {
      await runAsync('UPDATE users SET is_admin = 1 WHERE id = ?', [user.id]);
      user.is_admin = 1;
    }

    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      {
        expiresIn: rememberMe ? '30d' : '1d'
      }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: rememberMe
        ? 30 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Login failed'
    });
  }
});

app.post('/reset-password', async (req, res) => {
  try {

    const { token, password } = req.body;

    if (!isPasswordStrong(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character.' });
    }

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    const hashedPassword =
      await bcrypt.hash(password, 10);

    await runAsync(
      'UPDATE users SET password = ? WHERE id = ?',
      [
        hashedPassword,
        decoded.userId
      ]
    );

    res.json({
      success: true,
      message:
        'Password updated successfully.'
    });

  } catch (err) {
    console.error(err);

    res.status(400).json({
      error:
        'Invalid or expired reset link.'
    });
  }
});

app.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const generic = { message: 'If an account exists, a reset email has been sent.' };
  try {
    const { email } = req.body;
    const user = await getAsync('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.json(generic);

    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const origin = process.env.SITE_URL || 'http://localhost:3000';
    await resend.emails.send({
      from: 'orders@stitchedbytrae.com',
      replyTo: 'stitchedbytrae@gmail.com',
      to: email,
      subject: 'Reset your Stitched By Trae password',
      html: `
        <p>Click the link below to reset your password. This link expires in 1 hour.</p>
        <p><a href="${origin}/reset-password?token=${token}">Reset Password</a></p>
        <p>If you did not request this, you can safely ignore this email.</p>
      `
    });

    res.json(generic);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to send reset email.' });
  }
});

app.get('/me', async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.json({ loggedIn: false });
    }

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    const user = await getAsync(
      'SELECT * FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (!user) {
      return res.json({ loggedIn: false });
    }

    res.json({
      loggedIn: true,
      user
    });
  } catch {
    res.json({ loggedIn: false });
  }
});

app.post('/logout', (req, res) => {
  res.clearCookie('token');

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

app.post('/save-address', async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const { street, city, state, postal } = req.body;
    await runAsync(
      'UPDATE users SET street = ?, city = ?, state = ?, postal = ? WHERE id = ?',
      [street || '', city || '', state || '', postal || '', decoded.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to save address' });
  }
});

app.post('/update-profile', async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        error: 'Not logged in'
      });
    }

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    const {
      street,
      city,
      state,
      postal
    } = req.body;

    await runAsync(
      `UPDATE users
       SET street = ?, city = ?, state = ?, postal = ?
       WHERE id = ?`,
      [
        street,
        city,
        state,
        postal,
        decoded.userId
      ]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Unable to update profile'
    });
  }
});

app.get('/order-lookup', orderLookupLimiter, async (req, res) => {
  const { orderNumber, lastName } = req.query;
  if (!orderNumber || !lastName) {
    return res.sendFile('order-lookup.html', { root: process.cwd() });
  }
  try {
    const order = await findOrderByNumberAndLastName(orderNumber, lastName);
    if (!order) return res.status(404).json({ error: 'Order not found. Please check your order number and last name.' });

    return res.json({
      orderNumber: order.order_number,
      status: order.status,
      items: JSON.parse(order.items || '[]'),
      total: order.total,
      shipping: order.shipping,
      shippingCost: order.shipping_cost,
      trackingNumber: order.tracking_number || null,
      createdAt: order.created_at,
      deliveryMethod: order.delivery_method || 'ship',
      ksuCampus: order.ksu_campus || null,
      ksuMeetupLocation: order.ksu_meetup_location || null,
      ksuDeliveryDay: order.ksu_delivery_day || null,
      ksuDeliveryTime: order.ksu_delivery_time || null,
      missedDeliveryCount: order.missed_delivery_count || 0,
    });
  } catch (err) {
    console.error('Order lookup error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

app.get('/my-orders', async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        error: 'Not logged in'
      });
    }

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    const user = await getAsync(
      'SELECT * FROM users WHERE id = ?',
      [decoded.userId]
    );

    const orders = await allAsync(
      'SELECT * FROM orders WHERE email = ? ORDER BY created_at DESC',
      [user.email]
    );

    res.json(orders);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Unable to load orders'
    });
  }
});

app.get('/admin/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await allAsync(
      'SELECT * FROM orders ORDER BY created_at DESC'
    );

    res.json(orders);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Unable to load orders'
    });
  }
});

app.get('/orders', requireAdmin, async (req, res) => {
  try {
    const rows = await allAsync('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(rows.map(parseOrderRow));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load orders.' });
  }
});

app.post('/orders', async (req, res) => {
  try {
    const {
      fullName,
      email,
      street,
      city,
      state,
      postal,
      shipping,
      shippingCost,
      total,
      items,
      deliveryMethod,
      ksuCampus,
      ksuMeetupLocation,
      ksuDeliveryDay,
      ksuDeliveryTime,
      ksuPhone,
      ksuId,
      ksuPolicyAck
    } = req.body;

    if (!email || !items?.length) {
      return res.status(400).json({ error: 'Email and order items are required.' });
    }

    const normalizedDeliveryMethod = deliveryMethod === 'ksu' ? 'ksu' : 'ship';

    if (normalizedDeliveryMethod === 'ksu' && !isValidKsuId(ksuId)) {
      return res.status(400).json({ error: 'A valid 9-digit KSU ID number (starting with 00 or 000) is required for campus delivery.' });
    }

    if (normalizedDeliveryMethod === 'ksu' && !isValidKsuDeliveryTime(ksuDeliveryTime)) {
      return res.status(400).json({ error: 'A preferred delivery time no later than 6:00 PM is required for campus delivery.' });
    }

    if (normalizedDeliveryMethod === 'ksu' && ksuPolicyAck !== true) {
      return res.status(400).json({ error: 'You must acknowledge the campus delivery late fee policy.' });
    }

    if (await isWeeklyOrderLimitReached()) {
      return res.status(429).json({ error: 'Weekly order limit reached. Please try again next week.' });
    }

    try {
      const token = req.cookies.token;
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        await runAsync(
          `UPDATE users SET name = ?, street = ?, city = ?, state = ?, postal = ? WHERE id = ?`,
          [fullName || null, street, city, state, postal, decoded.userId]
        );
      }
    } catch (err) {
      console.error('Unable to save customer address:', err);
    }

    const orderNumber = createOrderNumber();
    const now = new Date().toISOString();
    const itemsJson = JSON.stringify(items.map(item => ({ ...item, price: getItemPrice(item) })));

    await runAsync(
      `INSERT INTO orders (
        order_number, full_name, email, street, city, state, postal,
        shipping, shipping_cost, total, status, items, created_at, updated_at,
        delivery_method, ksu_campus, ksu_meetup_location, ksu_delivery_day, ksu_delivery_time, ksu_phone, ksu_id_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        fullName,
        email,
        street,
        city,
        state,
        postal,
        shipping,
        shippingCost,
        total,
        'confirmed',
        itemsJson,
        now,
        now,
        normalizedDeliveryMethod,
        ksuCampus || null,
        ksuMeetupLocation || null,
        ksuDeliveryDay || null,
        ksuDeliveryTime || null,
        ksuPhone || null,
        normalizedDeliveryMethod === 'ksu' ? ksuId.trim() : null
      ]
    );


    const order = {
      order_number: orderNumber,
      full_name: fullName,
      email,
      street,
      city,
      state,
      postal,
      shipping,
      shipping_cost: shippingCost,
      total,
      status: 'confirmed',
      items,
      delivery_method: normalizedDeliveryMethod,
      ksu_campus: ksuCampus || null,
      ksu_meetup_location: ksuMeetupLocation || null,
      ksu_delivery_day: ksuDeliveryDay || null,
      ksu_delivery_time: ksuDeliveryTime || null,
      ksu_phone: ksuPhone || null,
      ksu_id_number: normalizedDeliveryMethod === 'ksu' ? ksuId.trim() : null
    };

    await sendOrderConfirmationEmail(order);
    sendOwnerNotificationEmail(order).catch(err => console.error('Owner notification failed:', err));

    res.json({ orderNumber, message: 'Order saved and confirmation email sent.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save the order.' });
  }
});

app.post('/create-checkout-session', async (req, res) => {
  try {
    const {
      fullName,
      email: submittedEmail,
      street,
      city,
      state,
      postal,
      shipping,
      promotionCodeId,
      discountCode,
      referralCode,
      deliveryMethod,
      ksuCampus,
      ksuMeetupLocation,
      ksuDeliveryDay,
      ksuDeliveryTime,
      ksuPhone,
      ksuId,
      ksuPolicyAck
    } = req.body;

    const email = typeof submittedEmail === 'string' ? submittedEmail.trim().toLowerCase() : '';
    const items = normalizeCheckoutItems(req.body.items);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !items) {
      return res.status(400).json({ error: 'A valid email and order items are required.' });
    }

    const normalizedDeliveryMethod = deliveryMethod === 'ksu' ? 'ksu' : 'ship';
    if (normalizedDeliveryMethod === 'ksu' && !isValidKsuId(ksuId)) {
      return res.status(400).json({ error: 'A valid 9-digit KSU ID number (starting with 00 or 000) is required for campus delivery.' });
    }

    if (normalizedDeliveryMethod === 'ksu' && !isValidKsuDeliveryTime(ksuDeliveryTime)) {
      return res.status(400).json({ error: 'A preferred delivery time no later than 6:00 PM is required for campus delivery.' });
    }

    if (normalizedDeliveryMethod === 'ksu' && ksuPolicyAck !== true) {
      return res.status(400).json({ error: 'You must acknowledge the campus delivery late fee policy.' });
    }

    if (await isWeeklyOrderLimitReached()) {
      return res.status(429).json({ error: 'Weekly order limit reached. Please try again next week.' });
    }

    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Stripe secret key is not configured.' });
    }

    if (promotionCodeId && discountCode) {
      return res.status(400).json({ error: 'Only one discount can be used per order. Remove your current discount before applying another offer.' });
    }

    let customerUser = null;
    if (req.cookies.token) {
      try {
        const decoded = jwt.verify(req.cookies.token, JWT_SECRET);
        customerUser = await getAsync('SELECT id, email FROM users WHERE id = ?', [decoded.userId]);
      } catch {
        if (discountCode) return res.status(401).json({ error: 'Log in to use your account reward.' });
      }
    }

    let discount = null;
    if (discountCode) {
      if (!customerUser || customerUser.email.toLowerCase() !== email) {
        return res.status(403).json({ error: 'Log in with the account that owns this discount and use that email at checkout.' });
      }
      discount = await customerFeatures.getDiscount(discountCode, customerUser.id);
      if (!discount) return res.status(400).json({ error: 'This discount is invalid, already used, or belongs to another account.' });
    }

    let referral = null;
    if (referralCode) {
      referral = await customerFeatures.validateReferral(referralCode, email);
      if (!referral) return res.status(400).json({ error: 'That referral code is invalid or cannot be used with this email.' });
    }

    try {
      if (customerUser) {
        await runAsync(
          `UPDATE users SET name = ?, street = ?, city = ?, state = ?, postal = ? WHERE id = ?`,
          [fullName || null, street, city, state, postal, customerUser.id]
        );
      }
    } catch (err) {
      console.error('Unable to save customer address:', err);
    }

    const inventory = new Map();
    for (const item of items.filter(value => value.isReadyToShip)) {
      if (inventory.has(item.inventoryId)) continue;
      const inventoryItem = await getAsync(
        `SELECT id, name, product_name, details, price_cents, quantity
         FROM ready_to_ship_inventory WHERE id = ? AND active = 1`,
        [item.inventoryId]
      );
      if (!inventoryItem || inventoryItem.product_name !== item.product) {
        return res.status(400).json({ error: 'A ready-to-ship item is no longer available.' });
      }
      inventory.set(item.inventoryId, inventoryItem);
    }

    if (discount?.kind === 'birthday_bogo') {
      const freeInventory = inventory.get(discount.inventory_id);
      const freeHatCount = items.filter(item =>
        item.isReadyToShip && item.inventoryId === discount.inventory_id
      ).length;
      const hasFreeHat = freeHatCount > 0;
      const hasQualifyingPaidHat = freeInventory && items.some(item =>
        item.isReadyToShip &&
        inventory.has(item.inventoryId) &&
        inventory.get(item.inventoryId).price_cents >= freeInventory.price_cents &&
        (item.inventoryId !== discount.inventory_id || freeHatCount >= 2)
      );
      if (!hasFreeHat || !hasQualifyingPaidHat) {
        return res.status(400).json({
          error: 'Add another eligible ready-to-ship hat of equal or greater value to use this birthday BOGO.'
        });
      }
    }

    const { lineItems, totalCents, inventoryQuantities } = buildCheckoutLineItems(
      items,
      shipping,
      normalizedDeliveryMethod,
      inventory,
      discount?.kind === 'birthday_bogo' ? discount.inventory_id : null
    );
    if (discount?.kind === 'points' && totalCents <= discount.amount_cents) {
      return res.status(400).json({ error: 'This reward cannot exceed the order total. Add an eligible purchase or choose another discount.' });
    }

    const storedItems = items.map(item => {
      if (!item.isReadyToShip) return item;
      const inventoryItem = inventory.get(item.inventoryId);
      const index = items.filter(previous => previous.isReadyToShip && previous.inventoryId === item.inventoryId)
        .slice(0, items.indexOf(item)).length;
      const isBogoFree = discount?.kind === 'birthday_bogo' &&
        item.inventoryId === discount.inventory_id && index === 0;
      return {
        product: item.product,
        colors: [],
        isReadyToShip: true,
        inventoryId: item.inventoryId,
        inventoryName: inventoryItem.name,
        inventoryDetails: inventoryItem.details,
        birthdayBogoFree: isBogoFree,
        price: isBogoFree ? 0 : inventoryItem.price_cents / 100
      };
    });

    const orderNumber = createOrderNumber();
    const now = new Date().toISOString();
    const itemsJson = JSON.stringify(storedItems);
    const computedShippingCents = normalizedDeliveryMethod === 'ksu' ? 500 : shipping === 'express' ? 1200 : 500;
    const computedShipping = computedShippingCents / 100;
    let insertResult;
    try {
      insertResult = await transactionAsync(async ({ runAsync: txRun }) => {
        const insertedOrder = await txRun(
          `INSERT INTO orders (
            order_number, full_name, email, street, city, state, postal,
            shipping, shipping_cost, total, status, items, created_at, updated_at,
            delivery_method, ksu_campus, ksu_meetup_location, ksu_delivery_day, ksu_delivery_time,
            ksu_phone, ksu_id_number, referral_code, reward_discount_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderNumber, fullName || '', email, street || '', city || '', state || '', postal || '',
            normalizedDeliveryMethod === 'ksu' ? 'ksu' : shipping,
            computedShipping, totalCents / 100, 'payment_pending', itemsJson, now, now,
            normalizedDeliveryMethod, ksuCampus || null, ksuMeetupLocation || null,
            ksuDeliveryDay || null, ksuDeliveryTime || null, ksuPhone || null,
            normalizedDeliveryMethod === 'ksu' ? ksuId.trim() : null,
            referral ? String(referralCode).trim() : null,
            discount?.id || null
          ]
        );
        for (const [inventoryId, quantity] of inventoryQuantities) {
          const reserved = await txRun(
            `UPDATE ready_to_ship_inventory SET quantity = quantity - ?, updated_at = ?
             WHERE id = ? AND active = 1 AND quantity >= ?`,
            [quantity, now, inventoryId, quantity]
          );
          if (!reserved.changes) throw new Error('INVENTORY_UNAVAILABLE');
          await txRun(
            `INSERT INTO inventory_reservations (order_id, inventory_id, quantity, created_at)
             VALUES (?, ?, ?, ?)`,
            [insertedOrder.lastID, inventoryId, quantity, now]
          );
        }
        if (discount) {
          const reserved = await txRun(
            `UPDATE reward_discounts SET status = 'reserved'
             WHERE id = ? AND status = 'available'`,
            [discount.id]
          );
          if (!reserved.changes) throw new Error('DISCOUNT_UNAVAILABLE');
        }
        return insertedOrder;
      });
    } catch (error) {
      if (error.message === 'INVENTORY_UNAVAILABLE') {
        return res.status(409).json({ error: 'One or more ready-to-ship items sold out. Refresh the page and update your cart.' });
      }
      if (error.message === 'DISCOUNT_UNAVAILABLE') {
        return res.status(409).json({ error: 'This discount was just used or is already being checked out.' });
      }
      throw error;
    }

    const createdId = insertResult.lastID;
    const origin = (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

    const sessionParams = {
      line_items: lineItems,
      mode: 'payment',
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout?payment=cancel`,
      customer_email: email,
      metadata: { orderNumber, orderId: String(createdId) }
    };
    if (discount?.kind === 'points') {
      sessionParams.discounts = [{ coupon: discount.couponId }];
    } else if (promotionCodeId) {
      sessionParams.discounts = [{ promotion_code: promotionCodeId }];
    } else if (!discount) {
      sessionParams.allow_promotion_codes = true;
    }
    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (error) {
      await customerFeatures.releaseCheckout({ metadata: { orderId: String(createdId) } });
      await runAsync('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', ['checkout_failed', new Date().toISOString(), createdId]);
      throw error;
    }

    await runAsync('UPDATE orders SET stripe_session_id = ? WHERE id = ?', [session.id, createdId]);
    if (discount) {
      await runAsync(
        'UPDATE reward_discounts SET checkout_session_id = ? WHERE id = ? AND status = ?',
        [session.id, discount.id, 'reserved']
      );
    }

    res.json({ url: session.url, orderNumber, orderId: createdId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to create Stripe checkout session.' });
  }
});

app.get('/validate-promo', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'No code provided' });
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
  try {
    const results = await stripe.promotionCodes.list({
      code: code.trim(),
      active: true,
      limit: 1,
      expand: ['data.promotion.coupon']
    });
    const promo = results.data[0];
    if (!promo) return res.status(404).json({ error: 'Invalid or expired promo code' });
    const promotion = promo.promotion;
    if (promotion?.type !== 'coupon') {
      return res.status(400).json({ error: 'This promotion type is not supported at checkout.' });
    }
    const couponValue = promotion.coupon;
    const coupon = typeof couponValue === 'object'
      ? couponValue
      : await stripe.coupons.retrieve(couponValue);
    if (coupon.amount_off != null) {
      return res.json({
        valid: true,
        discount: coupon.amount_off / 100,
        promotionCodeId: promo.id,
        label: coupon.name || code.trim()
      });
    }
    if (coupon.percent_off != null) {
      return res.json({
        valid: true,
        discount: null,
        percentOff: coupon.percent_off,
        promotionCodeId: promo.id,
        label: coupon.name || code.trim()
      });
    }
    return res.status(400).json({ error: 'This promotion does not apply a supported discount.' });
  } catch (err) {
    console.error('Promo validation error:', err);
    res.status(500).json({ error: 'Unable to validate promo code' });
  }
});

app.get('/confirm-order', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const orderId = Number(session.metadata?.orderId);
    if (!orderId) return res.status(400).json({ error: 'Order not found in session' });

    const orderRow = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!orderRow) return res.status(404).json({ error: 'Order not found' });

    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;
    await runAsync(
      `UPDATE orders SET status = 'confirmed', payment_intent_id = ?, total = ?, updated_at = ?
       WHERE id = ?`,
      [paymentIntentId, Number(session.amount_total || 0) / 100, new Date().toISOString(), orderId]
    );
    await customerFeatures.handlePaidOrder(
      { ...orderRow, status: 'confirmed', total: Number(session.amount_total || 0) / 100 },
      session
    );
    if (orderRow.status !== 'confirmed') {
      const order = parseOrderRow({ ...orderRow, status: 'confirmed', total: Number(session.amount_total || 0) / 100 });
      sendOrderConfirmationEmail(order).catch(err => console.error('Confirmation email failed:', err));
      sendOwnerNotificationEmail(order).catch(err => console.error('Owner notification failed:', err));
    }

    res.json({ success: true, orderNumber: orderRow.order_number });
  } catch (err) {
    console.error('Confirm order error:', err);
    res.status(500).json({ error: 'Unable to confirm order' });
  }
});

async function sendRescheduleConfirmationEmail(order, newDay, newTime) {
  return resend.emails.send({
    from: 'orders@stitchedbytrae.com',
    replyTo: 'stitchedbytrae@gmail.com',
    to: order.email,
    subject: `Delivery rescheduled — Order #${order.order_number}`,
    html: `
      <div style="font-family:Georgia,serif;padding:24px;">
        <h2 style="color:#5a3e6b;">Your campus delivery has been rescheduled 🧶</h2>
        <p>We've charged the $${KSU_LATE_FEE_AMOUNT} missed-delivery fee and updated your pickup for order <strong>#${order.order_number}</strong>.</p>
        <p><strong>New Delivery Day:</strong> ${newDay}<br>
        <strong>New Delivery Time:</strong> ${newTime} (no later than 6:00 PM)</p>
        <p style="color:#b00020;">Remember: there's a 10-minute grace period. Being more than 10 minutes late will require another reschedule and another $${KSU_LATE_FEE_AMOUNT} fee.</p>
        <p>Questions? Email us at <a href="mailto:stitchedbytrae@gmail.com">stitchedbytrae@gmail.com</a></p>
      </div>
    `
  });
}

app.post('/missed-delivery/reschedule', async (req, res) => {
  try {
    const { orderNumber, lastName, newDeliveryDay, newDeliveryTime, policyAck } = req.body;

    const order = await findOrderByNumberAndLastName(orderNumber, lastName);
    if (!order) {
      return res.status(404).json({ error: 'Order not found. Please check your order number and last name.' });
    }

    if (order.delivery_method !== 'ksu') {
      return res.status(400).json({ error: 'This order is not set up for KSU Campus Delivery.' });
    }

    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    if (!validDays.includes(newDeliveryDay)) {
      return res.status(400).json({ error: 'Please choose a valid delivery day.' });
    }

    if (!isValidKsuDeliveryTime(newDeliveryTime)) {
      return res.status(400).json({ error: 'Please choose a delivery time no later than 6:00 PM.' });
    }

    if (policyAck !== true) {
      return res.status(400).json({ error: 'You must acknowledge the late fee policy to reschedule.' });
    }

    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Stripe secret key is not configured.' });
    }

    const origin = (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

    const session = await stripe.checkout.sessions.create({
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Missed Delivery Late Fee — Order #${order.order_number}` },
          unit_amount: KSU_LATE_FEE_AMOUNT * 100
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${origin}/missed-delivery?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/missed-delivery?canceled=1`,
      customer_email: order.email,
      metadata: {
        orderId: String(order.id),
        newDeliveryDay,
        newDeliveryTime
      }
    });

    await runAsync(
      'UPDATE orders SET pending_reschedule_day = ?, pending_reschedule_time = ?, pending_reschedule_session_id = ? WHERE id = ?',
      [newDeliveryDay, newDeliveryTime, session.id, order.id]
    );

    res.json({ url: session.url });
  } catch (err) {
    console.error('Missed delivery reschedule error:', err);
    res.status(500).json({ error: 'Unable to start the late fee checkout.' });
  }
});

app.get('/missed-delivery/confirm', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const orderId = Number(session.metadata?.orderId);
    if (!orderId) return res.status(400).json({ error: 'Order not found in session' });

    const orderRow = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!orderRow) return res.status(404).json({ error: 'Order not found' });

    const newDay = session.metadata?.newDeliveryDay || orderRow.pending_reschedule_day;
    const newTime = session.metadata?.newDeliveryTime || orderRow.pending_reschedule_time;

    if (orderRow.pending_reschedule_session_id === session_id) {
      await runAsync(
        `UPDATE orders SET
          ksu_delivery_day = ?,
          ksu_delivery_time = ?,
          missed_delivery_count = missed_delivery_count + 1,
          pending_reschedule_day = NULL,
          pending_reschedule_time = NULL,
          pending_reschedule_session_id = NULL,
          updated_at = ?
        WHERE id = ?`,
        [newDay, newTime, new Date().toISOString(), orderId]
      );

      const updatedOrder = parseOrderRow({ ...orderRow, ksu_delivery_day: newDay, ksu_delivery_time: newTime });
      sendRescheduleConfirmationEmail(updatedOrder, newDay, newTime).catch(err => console.error('Reschedule email failed:', err));
    }

    res.json({
      success: true,
      orderNumber: orderRow.order_number,
      newDeliveryDay: newDay,
      newDeliveryTime: newTime
    });
  } catch (err) {
    console.error('Missed delivery confirm error:', err);
    res.status(500).json({ error: 'Unable to confirm the reschedule.' });
  }
});

app.post('/orders/:id/resend-confirmation', requireAdmin, async (req, res) => {
  try {
    const orderRow = await getAsync('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
    if (!orderRow) return res.status(404).json({ error: 'Order not found' });
    const order = parseOrderRow(orderRow);
    await sendOrderConfirmationEmail(order);
    res.json({ success: true, order_number: order.order_number });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send confirmation email' });
  }
});

app.patch('/orders/:id/tracking', requireAdmin, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { trackingNumber } = req.body;
    if (!trackingNumber) return res.status(400).json({ error: 'Tracking number is required.' });

    const orderRow = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    await runAsync(
      'UPDATE orders SET tracking_number = ?, updated_at = ? WHERE id = ?',
      [trackingNumber, new Date().toISOString(), orderId]
    );

    const updatedOrder = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
    res.json(parseOrderRow(updatedOrder));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update tracking number.' });
  }
});

app.post('/orders/:id/ship', requireAdmin, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const trackingNumber = req.body.trackingNumber || `TRK-${Date.now().toString().slice(-8)}`;

    const orderRow = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!orderRow) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const order = parseOrderRow(orderRow);
    await sendShippingEmail(order, trackingNumber);

    await runAsync(
      'UPDATE orders SET status = ?, tracking_number = ?, updated_at = ? WHERE id = ?',
      ['shipped', trackingNumber, new Date().toISOString(), orderId]
    );

    const updatedOrder = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
    res.json(parseOrderRow(updatedOrder));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to mark order as shipped.' });
  }
});

app.patch('/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { status } = req.body;

    if (!ADVANCEABLE_ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${ADVANCEABLE_ORDER_STATUSES.join(', ')}.` });
    }

    const orderRow = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!orderRow) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const order = parseOrderRow(orderRow);
    const now = new Date().toISOString();

    if (status === 'making') {
      await sendProductionStartedEmail(order);
    } else if (status === 'delivered') {
      await sendDeliveryConfirmationEmail(order);
    }

    if (status === 'delivered') {
      await runAsync(
        'UPDATE orders SET status = ?, delivered_at = ?, updated_at = ? WHERE id = ?',
        [status, now, now, orderId]
      );
    } else {
      await runAsync(
        'UPDATE orders SET status = ?, updated_at = ? WHERE id = ?',
        [status, now, orderId]
      );
    }

    const updatedOrder = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (status === 'delivered') {
      await customerFeatures.scheduleReviewRequest(updatedOrder);
    }
    res.json(parseOrderRow(updatedOrder));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to update order status.' });
  }
});

customerFeatures = registerCustomerFeatureRoutes({
  app,
  runAsync,
  getAsync,
  allAsync,
  transactionAsync,
  jwt,
  jwtSecret: () => JWT_SECRET,
  requireAdmin,
  resend,
  stripe,
  uploadDirectory,
  siteUrl: (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '')
});

app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const clean = req.path.slice(0, -5) || '/';
    const qs = req.url.slice(req.path.length);
    return res.redirect(301, clean + qs);
  }
  next();
});
app.use(express.static('.', { extensions: ['html'] }));

async function startServer() {
  try {
    const row = await getAsync('SELECT value FROM app_secrets WHERE key = ?', ['jwt_secret']);
    if (row) {
      JWT_SECRET = row.value;
    } else {
      JWT_SECRET = crypto.randomBytes(64).toString('hex');
      await runAsync('INSERT INTO app_secrets (key, value) VALUES (?, ?)', ['jwt_secret', JWT_SECRET]);
      console.log('Generated new JWT secret and saved to database.');
    }

    await initializeCustomerFeatureSchema({ runAsync, allAsync, uploadDirectory });

    app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
      console.log(`Server running on port ${process.env.PORT || 3000}`);
    });
    const processScheduledEmails = () => {
      customerFeatures.processScheduledEmails().catch(err => {
        console.error('Scheduled customer email processing failed:', err);
      });
    };
    processScheduledEmails();
    const scheduler = setInterval(processScheduledEmails, 15 * 60 * 1000);
    scheduler.unref();
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}