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


dotenv.config();

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

async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not logged in' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
    replyTo: 'stitchedbytrae@gmail.com',
    to: order.email,
    subject: `Order Confirmation #${order.order_number}`,
    html: buildOrderConfirmationEmail(order)
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

app.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    await runAsync(
      'INSERT INTO users (name, email, password, email_verified, verification_token) VALUES (?, ?, ?, 0, ?)',
      [name, email, hashedPassword, verificationToken]
    );

    const origin = process.env.SITE_URL || 'http://localhost:3000';
    await resend.emails.send({
      from: 'orders@stitchedbytrae.com',
      replyTo: 'stitchedbytrae@gmail.com',
      to: email,
      subject: 'Verify your Stitched By Trae account',
      html: `
        <h2>Welcome to Stitched By Trae! 🧶</h2>
        <p>Hi ${name},</p>
        <p>Thanks for creating an account! Please click the link below to verify your email address.</p>
        <p><a href="${origin}/verify-email.html?token=${verificationToken}" style="background:#9b6ea8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0;">Verify My Email</a></p>
        <p>If you did not create an account, you can safely ignore this email.</p>
      `
    });

    res.json({ success: true, message: 'Account created! Please check your email to verify your account before logging in.' });
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: 'An account with that email already exists.'
    });
  }
});

app.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/login.html?error=invalid');
  try {
    const user = await getAsync('SELECT * FROM users WHERE verification_token = ?', [token]);
    if (!user) return res.redirect('/login.html?error=invalid');
    await runAsync(
      'UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?',
      [user.id]
    );
    res.redirect('/login.html?verified=1');
  } catch (err) {
    console.error(err);
    res.redirect('/login.html?error=invalid');
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

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
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

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
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
      process.env.JWT_SECRET,
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
        <p><a href="${origin}/reset-password.html?token=${token}">Reset Password</a></p>
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
      process.env.JWT_SECRET
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
      process.env.JWT_SECRET
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
    return res.status(400).json({ error: 'Order number and last name are required.' });
  }
  try {
    const order = await getAsync('SELECT * FROM orders WHERE order_number = ?', [orderNumber.trim()]);
    if (!order) return res.status(404).json({ error: 'Order not found. Please check your order number and last name.' });

    const nameParts = (order.full_name || '').trim().split(' ');
    const storedLastName = nameParts[nameParts.length - 1].toLowerCase();
    if (storedLastName !== lastName.trim().toLowerCase()) {
      return res.status(404).json({ error: 'Order not found. Please check your order number and last name.' });
    }

    return res.json({
      orderNumber: order.order_number,
      status: order.status,
      items: JSON.parse(order.items || '[]'),
      total: order.total,
      shipping: order.shipping,
      shippingCost: order.shipping_cost,
      trackingNumber: order.tracking_number || null,
      createdAt: order.created_at,
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
      process.env.JWT_SECRET
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
      items
    } = req.body;

    if (!email || !items?.length) {
      return res.status(400).json({ error: 'Email and order items are required.' });
    }

    if (await isWeeklyOrderLimitReached()) {
      return res.status(429).json({ error: 'Weekly order limit reached. Please try again next week.' });
    }
    try {
  const token = req.cookies.token;

  if (token) {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

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

    console.log('Order created:', email);

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
  return res.status(500).json({
    error: 'Stripe secret key is not configured.'
  });
}

try {
  const token = req.cookies.token;

  if (token) {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

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
  }
} catch (err) {
  console.error('Unable to save customer address:', err);
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

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});