import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import Stripe from 'stripe';
import { Resend } from 'resend';
import sqlite3 from 'sqlite3';

dotenv.config();

const app = express();
app.use(cors());
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = Number(session.metadata?.orderId);
    if (orderId) {
      try {
        const orderRow = await getAsync('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orderRow) {
          const order = parseOrderRow(orderRow);
          await sendOrderConfirmationEmail(order);
          await runAsync(
            'UPDATE orders SET status = ?, updated_at = ? WHERE id = ?',
            ['confirmed', new Date().toISOString(), orderId]
          );
        }
      } catch (err) {
        console.error('Error processing webhook order:', err);
      }
    }
  }

  res.json({ received: true });
});
app.use(express.json());
app.use(express.static('.'));

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const resendApiKey = process.env.RESEND_API_KEY || '';

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2022-11-15'
});
const resend = new Resend(resendApiKey);

const WEEKLY_ORDER_LIMIT = Number(process.env.WEEKLY_ORDER_LIMIT || 20);

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

const db = new sqlite3.Database('./orders.db', err => {
  if (err) {
    console.error('Unable to open orders.db', err);
    process.exit(1);
  }
});

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
      stripe_session_id TEXT
    )
  `);
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

function getItemPrice(item) {
  return Number(item.price || 0);
}

function buildOrderConfirmationEmail(order) {
  const itemsHtml = order.items.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${item.product}</td>
      <td>${item.colors?.join(', ') || ''}</td>
      <td>${item.headCircumference || item.size || 'N/A'}</td>
      <td>$${getItemPrice(item)}</td>
    </tr>
  `).join('');

  return `
    <h1>🧶 Thank You for Your Order!</h1>
    <p>Your order has been received and is being prepared.</p>
    <p><strong>Order Number:</strong> ${order.order_number}</p>
    <p><strong>Total:</strong> $${order.total}</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; max-width:600px;">
      <thead>
        <tr>
          <th>#</th>
          <th>Product</th>
          <th>Colors</th>
          <th>Details</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    <p><strong>Shipping:</strong> ${order.shipping} ($${order.shipping_cost})</p>
    <p>We will send you a shipping notification once your order ships.</p>
  `;
}

async function sendOrderConfirmationEmail(order) {
  return resend.emails.send({
    from: 'orders@stitchedbytrae.com',
    to: order.email,
    subject: `Order Confirmation #${order.order_number}`,
    html: buildOrderConfirmationEmail(order)
  });
}

async function sendShippingEmail(order, trackingNumber) {
  return resend.emails.send({
    from: 'orders@stitchedbytrae.com',
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

app.get('/orders', async (req, res) => {
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
      items
    } = req.body;

    if (!email || !items?.length) {
      return res.status(400).json({ error: 'Email and order items are required.' });
    }

    if (await isWeeklyOrderLimitReached()) {
      return res.status(429).json({ error: 'Weekly order limit reached. Please try again next week.' });
    }

    const orderNumber = createOrderNumber();
    const now = new Date().toISOString();
    const itemsJson = JSON.stringify(items.map(item => ({ ...item, price: getItemPrice(item) })));

    await runAsync(
      `INSERT INTO orders (
        order_number, full_name, email, street, city, state, postal,
        shipping, shipping_cost, total, status, items, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        now
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
      items
    };

    await sendOrderConfirmationEmail(order);

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
      email,
      street,
      city,
      state,
      postal,
      shipping,
      shippingCost,
      total,
      items,
      lineItems
    } = req.body;

    if (!email || !items?.length || !Array.isArray(lineItems) || !lineItems.length) {
      return res.status(400).json({ error: 'Email, order items, and Stripe line items are required.' });
    }

    if (await isWeeklyOrderLimitReached()) {
      return res.status(429).json({ error: 'Weekly order limit reached. Please try again next week.' });
    }

    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Stripe secret key is not configured.' });
    }

    const orderNumber = createOrderNumber();
    const now = new Date().toISOString();
    const itemsJson = JSON.stringify(items.map(item => ({ ...item, price: getItemPrice(item) })));

    const insertResult = await runAsync(
      `INSERT INTO orders (
        order_number, full_name, email, street, city, state, postal,
        shipping, shipping_cost, total, status, items, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        'payment_pending',
        itemsJson,
        now,
        now
      ]
    );

    const createdId = insertResult.lastID;
    const origin = req.headers.origin || `http://localhost:${process.env.PORT || 3000}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${origin}/success.html`,
      cancel_url: `${origin}/checkout.html?payment=cancel`,
      customer_email: email,
      metadata: {
        orderNumber,
        orderId: String(createdId)
      }
    });

    await runAsync('UPDATE orders SET stripe_session_id = ? WHERE id = ?', [session.id, createdId]);

    res.json({ url: session.url, orderNumber, orderId: createdId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to create Stripe checkout session.' });
  }
});

app.post('/orders/:id/ship', async (req, res) => {
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

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});