import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import rateLimit from 'express-rate-limit';

export const REVIEW_DISCLAIMER_VERSION = '2026-10-31';

const REVIEW_UPLOAD_LIMIT = 5 * 1024 * 1024;
const REVIEW_EMAIL_DELAY_DAYS = 3;
const REVIEW_RATING_STATUS = rating => rating >= 4 ? 'published' : 'pending';
const HAT_PRODUCTS = new Set(['Beanie', 'Bucket Hat', 'Ruffle Bucket Hat']);

function isValidImage(filePath, mimetype) {
  const bytes = fs.readFileSync(filePath);
  if (mimetype === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimetype === 'image/webp') {
    return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

function safeUser(req, jwt, jwtSecret) {
  const token = req.cookies?.token;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, jwtSecret());
    return decoded.userId;
  } catch {
    return null;
  }
}

function makeCode(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function parseOrderItems(order) {
  try {
    const items = JSON.parse(order.items || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export async function initializeCustomerFeatureSchema({ runAsync, allAsync, uploadDirectory }) {
  await fs.promises.mkdir(uploadDirectory, { recursive: true });

  const userColumns = await allTableColumns(allAsync, 'users');
  for (const [name, definition] of [
    ['birthday_date', 'TEXT'],
    ['birthday_set_at', 'TEXT'],
    ['marketing_email_opt_in', 'INTEGER NOT NULL DEFAULT 0'],
    ['review_email_opt_in', 'INTEGER NOT NULL DEFAULT 1']
  ]) {
    if (!userColumns.has(name)) {
      await runAsync(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    }
  }

  const orderColumns = await allTableColumns(allAsync, 'orders');
  for (const [name, definition] of [
    ['payment_intent_id', 'TEXT'],
    ['referral_code', 'TEXT'],
    ['reward_discount_id', 'INTEGER']
  ]) {
    if (!orderColumns.has(name)) {
      await runAsync(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
    }
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      product_key TEXT NOT NULL,
      product_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body TEXT NOT NULL CHECK (length(trim(body)) > 0),
      photo_filename TEXT,
      photo_consent INTEGER NOT NULL DEFAULT 0,
      consented_at TEXT,
      disclaimer_version TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected', 'removed')),
      admin_response TEXT,
      submitted_at TEXT NOT NULL,
      moderated_at TEXT,
      UNIQUE(order_id, product_key)
    )`,
    `CREATE TABLE IF NOT EXISTS review_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      due_at TEXT NOT NULL,
      sent_at TEXT,
      claimed_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS review_removal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      UNIQUE(review_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS rewards_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      points INTEGER NOT NULL,
      activity TEXT NOT NULL,
      event_key TEXT NOT NULL UNIQUE,
      order_id INTEGER REFERENCES orders(id),
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS reward_discounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('points', 'birthday_bogo')),
      amount_cents INTEGER NOT NULL DEFAULT 0,
      points_cost INTEGER NOT NULL DEFAULT 0,
      inventory_id INTEGER,
      stripe_coupon_id TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      created_at TEXT NOT NULL,
      redeemed_at TEXT,
      checkout_session_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS birthday_reward_events (
      user_id INTEGER NOT NULL REFERENCES users(id),
      reward_year INTEGER NOT NULL,
      birthday_month INTEGER NOT NULL,
      discount_code TEXT,
      processed_at TEXT NOT NULL,
      email_sent_at TEXT,
      discount_notified_at TEXT,
      PRIMARY KEY(user_id, reward_year)
    )`,
    `CREATE TABLE IF NOT EXISTS referral_codes (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id INTEGER NOT NULL REFERENCES users(id),
      referred_email TEXT NOT NULL,
      referral_code TEXT NOT NULL,
      order_id INTEGER UNIQUE REFERENCES orders(id),
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      notified_at TEXT,
      UNIQUE(referred_email)
    )`,
    `CREATE TABLE IF NOT EXISTS ready_to_ship_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      product_name TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      inventory_id INTEGER NOT NULL REFERENCES ready_to_ship_inventory(id),
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'reserved',
      created_at TEXT NOT NULL,
      UNIQUE(order_id, inventory_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id, submitted_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status, submitted_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_review_requests_due ON review_requests(sent_at, due_at)',
    'CREATE INDEX IF NOT EXISTS idx_rewards_user ON rewards_ledger(user_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_inventory_active ON ready_to_ship_inventory(active, quantity)'
  ];

  for (const statement of statements) await runAsync(statement);

  const requestColumns = await allTableColumns(allAsync, 'review_requests');
  if (!requestColumns.has('claimed_at')) {
    await runAsync('ALTER TABLE review_requests ADD COLUMN claimed_at TEXT');
  }
  const referralColumns = await allTableColumns(allAsync, 'referrals');
  if (!referralColumns.has('notified_at')) {
    await runAsync('ALTER TABLE referrals ADD COLUMN notified_at TEXT');
  }
  const birthdayColumns = await allTableColumns(allAsync, 'birthday_reward_events');
  if (!birthdayColumns.has('discount_notified_at')) {
    await runAsync('ALTER TABLE birthday_reward_events ADD COLUMN discount_notified_at TEXT');
  }
}

async function allTableColumns(allAsync, table) {
  const rows = await allAsync(`PRAGMA table_info(${table})`);
  return new Set(rows.map(row => row.name));
}

export function registerCustomerFeatureRoutes({
  app,
  runAsync,
  getAsync,
  allAsync,
  transactionAsync,
  jwt,
  jwtSecret,
  requireAdmin,
  resend,
  stripe,
  uploadDirectory,
  siteUrl
}) {
  const storage = multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => {
      const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
      callback(null, `${crypto.randomUUID()}${extension || '.upload'}`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: REVIEW_UPLOAD_LIMIT, files: 1 },
    fileFilter: (req, file, callback) => {
      const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
      callback(allowedTypes.has(file.mimetype) ? null : new Error('Upload a JPEG, PNG, or WebP image.'), allowedTypes.has(file.mimetype));
    }
  });

  const requireCustomer = (req, res, next) => {
    const userId = safeUser(req, jwt, jwtSecret);
    if (!userId) return res.status(401).json({ error: 'Please log in to continue.' });
    req.customerUserId = userId;
    next();
  };
  const reviewSubmissionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Too many review submissions. Please try again later.' }
  });

  async function awardPoints(userId, points, activity, eventKey, orderId = null) {
    await runAsync(
      `INSERT INTO rewards_ledger (user_id, points, activity, event_key, order_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_key) DO NOTHING`,
      [userId, points, activity, eventKey, orderId, new Date().toISOString()]
    );
  }

  async function getPointsBalance(userId) {
    const row = await getAsync('SELECT COALESCE(SUM(points), 0) AS balance FROM rewards_ledger WHERE user_id = ?', [userId]);
    return Number(row?.balance || 0);
  }

  async function getOrCreateReferralCode(userId) {
    const existing = await getAsync('SELECT code FROM referral_codes WHERE user_id = ?', [userId]);
    if (existing) return existing.code;
    const code = makeCode('TRAE');
    await runAsync(
      'INSERT INTO referral_codes (user_id, code, created_at) VALUES (?, ?, ?)',
      [userId, code, new Date().toISOString()]
    );
    return code;
  }

  app.get('/api/reviews/published', async (req, res) => {
    try {
      const productName = String(req.query.product || '').trim();
      if (!productName || productName.length > 100) {
        return res.status(400).json({ error: 'A valid product name is required.' });
      }
      const reviews = await allAsync(
        `SELECT id, product_name, rating, body, photo_filename, admin_response, submitted_at
         FROM reviews WHERE product_name = ? AND status = 'published'
         ORDER BY submitted_at DESC LIMIT 100`,
        [productName]
      );
      res.json(reviews.map(review => ({
        ...review,
        photoUrl: review.photo_filename ? `/review-photos/${review.id}` : null
      })));
    } catch (error) {
      console.error('Unable to load published reviews:', error);
      res.status(500).json({ error: 'Unable to load reviews.' });
    }
  });

  app.get('/api/reviews/eligible', requireCustomer, async (req, res) => {
    try {
      const user = await getAsync('SELECT email FROM users WHERE id = ?', [req.customerUserId]);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const orders = await allAsync(
        `SELECT id, order_number, items, delivered_at FROM orders
         WHERE lower(email) = lower(?) AND status = 'delivered'
         ORDER BY delivered_at DESC`,
        [user.email]
      );
      const eligible = [];
      const seenProducts = new Set();
      for (const order of orders) {
        const items = parseOrderItems(order);
        for (const item of items) {
          const productName = String(item.product || '').trim();
          if (!productName) continue;
          const productKey = productName.toLowerCase();
          const key = `${order.id}:${productKey}`;
          if (seenProducts.has(key)) continue;
          seenProducts.add(key);
          const existing = await getAsync(
            'SELECT id FROM reviews WHERE order_id = ? AND product_key = ?',
            [order.id, productKey]
          );
          if (!existing) {
            eligible.push({
              orderId: order.id,
              orderNumber: order.order_number,
              deliveredAt: order.delivered_at,
              productName
            });
          }
        }
      }
      res.json(eligible);
    } catch (error) {
      console.error('Unable to load review eligibility:', error);
      res.status(500).json({ error: 'Unable to load eligible reviews.' });
    }
  });

  app.post('/api/reviews', requireCustomer, reviewSubmissionLimiter, (req, res, next) => {
    upload.single('photo')(req, res, error => {
      if (error) {
        return res.status(400).json({ error: error.message || 'Unable to upload photo.' });
      }
      next();
    });
  }, async (req, res) => {
    const photoPath = req.file?.path;
    try {
      const orderId = Number(req.body.orderId);
      const productName = String(req.body.productName || '').trim();
      const rating = Number(req.body.rating);
      const body = String(req.body.body || '').trim();
      const hasPhoto = Boolean(req.file);
      const photoConsent = req.body.photoConsent === 'true';
      if (!Number.isInteger(orderId) || orderId <= 0 ||
          !productName || productName.length > 100 ||
          !Number.isInteger(rating) || rating < 1 || rating > 5 ||
          !body || body.length > 5000) {
        return res.status(400).json({ error: 'Provide an eligible order, product, 1–5 star rating, and written review (up to 5,000 characters).' });
      }
      if (hasPhoto && !photoConsent) {
        return res.status(400).json({ error: 'Photo upload consent is required when you attach a photo.' });
      }
      if (req.file && !isValidImage(req.file.path, req.file.mimetype)) {
        return res.status(400).json({ error: 'The uploaded file is not a valid JPEG, PNG, or WebP image.' });
      }

      const user = await getAsync('SELECT email FROM users WHERE id = ?', [req.customerUserId]);
      const order = await getAsync(
        `SELECT id, order_number, items, status, delivered_at FROM orders
         WHERE id = ? AND lower(email) = lower(?)`,
        [orderId, user?.email]
      );
      if (!order || order.status !== 'delivered' || !order.delivered_at) {
        return res.status(403).json({ error: 'Reviews are available only for delivered orders on your account.' });
      }
      const purchasedProduct = parseOrderItems(order).some(item =>
        String(item.product || '').trim().toLowerCase() === productName.toLowerCase()
      );
      if (!purchasedProduct) {
        return res.status(403).json({ error: 'That product was not included in this order.' });
      }

      const now = new Date().toISOString();
      const insert = await transactionAsync(async ({ runAsync: txRun, getAsync: txGet }) => {
        const result = await txRun(
          `INSERT INTO reviews (
            order_id, user_id, product_key, product_name, rating, body, photo_filename,
            photo_consent, consented_at, disclaimer_version, status, submitted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            req.customerUserId,
            productName.toLowerCase(),
            productName,
            rating,
            body,
            req.file?.filename || null,
            hasPhoto ? 1 : 0,
            hasPhoto ? now : null,
            hasPhoto ? REVIEW_DISCLAIMER_VERSION : null,
            REVIEW_RATING_STATUS(rating),
            now
          ]
        );
        const priorVerifiedReview = await txGet(
          'SELECT id FROM reviews WHERE user_id = ? AND id != ? AND status != ? LIMIT 1',
          [req.customerUserId, result.lastID, 'removed']
        );
        if (!priorVerifiedReview) {
          await txRun(
            `INSERT INTO rewards_ledger (user_id, points, activity, event_key, order_id, created_at)
             VALUES (?, 50, 'First verified product review', ?, ?, ?)
             ON CONFLICT(event_key) DO NOTHING`,
            [req.customerUserId, `first-review:${req.customerUserId}`, orderId, now]
          );
        }
        return result;
      });

      res.status(201).json({
        success: true,
        reviewId: insert.lastID,
        status: REVIEW_RATING_STATUS(rating),
        message: rating >= 4 ? 'Your review is published.' : 'Your review was sent to the team for moderation.'
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ error: 'A review for this product and order has already been submitted.' });
      }
      console.error('Unable to submit review:', error);
      res.status(500).json({ error: 'Unable to submit your review.' });
    } finally {
      if (photoPath && !res.headersSent) {
        const review = await getAsync('SELECT id FROM reviews WHERE photo_filename = ?', [path.basename(photoPath)]).catch(() => null);
        if (!review) await fs.promises.unlink(photoPath).catch(error => console.error('Unable to remove unclaimed review upload:', error));
      }
    }
  });

  app.get('/api/reviews/mine', requireCustomer, async (req, res) => {
    try {
      const reviews = await allAsync(
        `SELECT id, order_id, product_name, rating, body, photo_filename, status,
                admin_response, submitted_at, moderated_at
         FROM reviews WHERE user_id = ? ORDER BY submitted_at DESC`,
        [req.customerUserId]
      );
      res.json(reviews.map(review => ({
        ...review,
        photoUrl: review.photo_filename && review.status === 'published' ? `/review-photos/${review.id}` : null
      })));
    } catch (error) {
      console.error('Unable to load customer reviews:', error);
      res.status(500).json({ error: 'Unable to load your reviews.' });
    }
  });

  app.post('/api/reviews/:id/removal-request', requireCustomer, async (req, res) => {
    try {
      const reviewId = Number(req.params.id);
      const reason = String(req.body.reason || '').trim();
      if (!Number.isInteger(reviewId) || reviewId <= 0 || !reason || reason.length > 1000) {
        return res.status(400).json({ error: 'A removal reason of up to 1,000 characters is required.' });
      }
      const review = await getAsync('SELECT id FROM reviews WHERE id = ? AND user_id = ?', [reviewId, req.customerUserId]);
      if (!review) return res.status(404).json({ error: 'Review not found.' });
      await runAsync(
        `INSERT INTO review_removal_requests (review_id, user_id, reason, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(review_id, user_id) DO NOTHING`,
        [reviewId, req.customerUserId, reason, new Date().toISOString()]
      );
      res.status(202).json({ success: true, message: 'Your privacy-related removal request was sent to the team.' });
    } catch (error) {
      console.error('Unable to create review removal request:', error);
      res.status(500).json({ error: 'Unable to submit your request.' });
    }
  });

  app.get('/review-photos/:id', async (req, res) => {
    try {
      const review = await getAsync(
        `SELECT photo_filename FROM reviews WHERE id = ? AND status = 'published' AND photo_consent = 1`,
        [Number(req.params.id)]
      );
      if (!review?.photo_filename) return res.sendStatus(404);
      res.type(path.extname(review.photo_filename));
      res.set('Cache-Control', 'public, max-age=86400');
      res.sendFile(path.resolve(uploadDirectory, path.basename(review.photo_filename)));
    } catch (error) {
      console.error('Unable to serve review photo:', error);
      res.sendStatus(500);
    }
  });

  app.get('/api/customer/rewards', requireCustomer, async (req, res) => {
    try {
      const user = await getAsync(
        `SELECT birthday_date, birthday_set_at, marketing_email_opt_in, review_email_opt_in
         FROM users WHERE id = ?`,
        [req.customerUserId]
      );
      const [balance, history, discounts, referralCode, referrals] = await Promise.all([
        getPointsBalance(req.customerUserId),
        allAsync(
          `SELECT points, activity, created_at FROM rewards_ledger
           WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
          [req.customerUserId]
        ),
        allAsync(
          `SELECT code, kind, amount_cents, status, created_at FROM reward_discounts
           WHERE user_id = ? ORDER BY created_at DESC`,
          [req.customerUserId]
        ),
        getOrCreateReferralCode(req.customerUserId),
        allAsync(
          `SELECT status, created_at FROM referrals WHERE referrer_user_id = ? ORDER BY created_at DESC`,
          [req.customerUserId]
        )
      ]);
      res.json({
        points: balance,
        history,
        discounts,
        referralCode,
        referralUrl: `${siteUrl}/checkout?ref=${encodeURIComponent(referralCode)}`,
        referrals,
        birthday: user?.birthday_date || null,
        birthdayLocked: Boolean(user?.birthday_set_at),
        emailPreferences: {
          marketing: Boolean(user?.marketing_email_opt_in),
          reviewRequests: Boolean(user?.review_email_opt_in)
        }
      });
    } catch (error) {
      console.error('Unable to load rewards account:', error);
      res.status(500).json({ error: 'Unable to load Trae Rewards.' });
    }
  });

  app.post('/api/customer/birthday', requireCustomer, async (req, res) => {
    try {
      const birthday = String(req.body.birthday || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
        return res.status(400).json({ error: 'Enter your birthday as a valid date.' });
      }
      const date = new Date(`${birthday}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birthday) {
        return res.status(400).json({ error: 'Enter a valid birthday.' });
      }
      const updated = await runAsync(
        `UPDATE users SET birthday_date = ?, birthday_set_at = ?
         WHERE id = ? AND birthday_set_at IS NULL`,
        [birthday, new Date().toISOString(), req.customerUserId]
      );
      if (!updated.changes) {
        return res.status(409).json({ error: 'Birthday rewards are locked after the birthday is first saved. Contact support for a correction.' });
      }
      res.json({ success: true, birthday, locked: true });
    } catch (error) {
      console.error('Unable to save birthday:', error);
      res.status(500).json({ error: 'Unable to save your birthday.' });
    }
  });

  app.patch('/api/customer/email-preferences', requireCustomer, async (req, res) => {
    try {
      const { marketing, reviewRequests } = req.body;
      if (typeof marketing !== 'boolean' || typeof reviewRequests !== 'boolean') {
        return res.status(400).json({ error: 'Email preferences must be true or false.' });
      }
      await runAsync(
        'UPDATE users SET marketing_email_opt_in = ?, review_email_opt_in = ? WHERE id = ?',
        [marketing ? 1 : 0, reviewRequests ? 1 : 0, req.customerUserId]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Unable to update email preferences:', error);
      res.status(500).json({ error: 'Unable to save email preferences.' });
    }
  });

  app.post('/api/customer/reward-redemptions', requireCustomer, async (req, res) => {
    try {
      const points = await getPointsBalance(req.customerUserId);
      if (points < 500) return res.status(400).json({ error: 'You need 500 points to redeem a $5 reward.' });
      const code = makeCode('TRAEREWARD');
      const now = new Date().toISOString();
      await transactionAsync(async ({ runAsync: txRun, getAsync: txGet }) => {
        const balance = await txGet(
          'SELECT COALESCE(SUM(points), 0) AS balance FROM rewards_ledger WHERE user_id = ?',
          [req.customerUserId]
        );
        if (Number(balance?.balance || 0) < 500) {
          throw new Error('INSUFFICIENT_POINTS');
        }
        await txRun(
          `INSERT INTO reward_discounts (code, user_id, kind, amount_cents, points_cost, created_at)
           VALUES (?, ?, 'points', 500, 500, ?)`,
          [code, req.customerUserId, now]
        );
        await txRun(
          `INSERT INTO rewards_ledger (user_id, points, activity, event_key, created_at)
           VALUES (?, -500, 'Redeemed for $5 off', ?, ?)`,
          [req.customerUserId, `redeem:${code}`, now]
        );
      }).catch(error => {
        if (error.message === 'INSUFFICIENT_POINTS') {
          error.statusCode = 409;
        }
        throw error;
      });
      res.status(201).json({ success: true, code, discount: 5 });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({ error: 'Your points balance changed. Refresh and try again.' });
      }
      console.error('Unable to redeem points:', error);
      res.status(500).json({ error: 'Unable to redeem your points.' });
    }
  });

  app.post('/api/customer/discounts/validate', requireCustomer, async (req, res) => {
    try {
      const code = String(req.body.code || '').trim();
      if (!code || code.length > 50) return res.status(400).json({ error: 'Enter a valid discount code.' });
      const discount = await getDiscount(code, req.customerUserId);
      if (!discount) return res.status(404).json({ error: 'This discount is invalid, already used, or belongs to another account.' });
      if (discount.kind === 'birthday_bogo') {
        const inventory = await getAsync(
          `SELECT id, name, product_name, details, price_cents, quantity
           FROM ready_to_ship_inventory WHERE id = ? AND active = 1`,
          [discount.inventory_id]
        );
        if (!inventory) return res.status(409).json({ error: 'The birthday reward item is no longer available.' });
        return res.json({
          valid: true,
          kind: discount.kind,
          code: discount.code,
          inventoryId: inventory.id,
          inventoryName: inventory.name,
          quantity: inventory.quantity,
          discount: inventory.price_cents / 100
        });
      }
      res.json({
        valid: true,
        kind: discount.kind,
        code: discount.code,
        discount: discount.amount_cents / 100
      });
    } catch (error) {
      console.error('Unable to validate customer discount:', error);
      res.status(500).json({ error: 'Unable to validate discount code.' });
    }
  });

  app.get('/api/inventory/ready-to-ship', async (req, res) => {
    try {
      const inventory = await allAsync(
        `SELECT id, item_code, name, product_name, details, price_cents, quantity
         FROM ready_to_ship_inventory WHERE active = 1 AND quantity > 0
         ORDER BY name`
      );
      res.json(inventory.map(item => ({ ...item, price: item.price_cents / 100, isHat: HAT_PRODUCTS.has(item.product_name) })));
    } catch (error) {
      console.error('Unable to load ready-to-ship inventory:', error);
      res.status(500).json({ error: 'Unable to load ready-to-ship items.' });
    }
  });

  app.get('/api/admin/reviews', requireAdmin, async (req, res) => {
    try {
      const reviews = await allAsync(
        `SELECT r.*, u.name AS customer_name, u.email AS customer_email,
                o.order_number, rr.reason AS removal_reason, rr.status AS removal_status
         FROM reviews r
         JOIN users u ON u.id = r.user_id
         JOIN orders o ON o.id = r.order_id
         LEFT JOIN review_removal_requests rr ON rr.review_id = r.id
         ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.submitted_at DESC`
      );
      res.json(reviews.map(review => ({
        ...review,
        photoUrl: review.photo_filename ? `/admin/reviews/${review.id}/photo` : null
      })));
    } catch (error) {
      console.error('Unable to load admin reviews:', error);
      res.status(500).json({ error: 'Unable to load reviews.' });
    }
  });

  app.get('/admin/reviews/:id/photo', requireAdmin, async (req, res) => {
    try {
      const review = await getAsync('SELECT photo_filename FROM reviews WHERE id = ?', [Number(req.params.id)]);
      if (!review?.photo_filename) return res.sendStatus(404);
      res.sendFile(path.resolve(uploadDirectory, path.basename(review.photo_filename)));
    } catch (error) {
      console.error('Unable to serve admin review photo:', error);
      res.sendStatus(500);
    }
  });

  app.patch('/api/admin/reviews/:id', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = String(req.body.status || '');
      const response = typeof req.body.response === 'string' ? req.body.response.trim() : null;
      if (!Number.isInteger(id) || id <= 0 || !['published', 'rejected'].includes(status) ||
          (response && response.length > 2000)) {
        return res.status(400).json({ error: 'Choose publish or reject and provide a response of up to 2,000 characters.' });
      }
      const result = await runAsync(
        `UPDATE reviews SET status = ?, admin_response = ?, moderated_at = ?
         WHERE id = ? AND status != 'removed'`,
        [status, response, new Date().toISOString(), id]
      );
      if (!result.changes) return res.status(404).json({ error: 'Review not found.' });
      res.json({ success: true });
    } catch (error) {
      console.error('Unable to moderate review:', error);
      res.status(500).json({ error: 'Unable to moderate review.' });
    }
  });

  app.post('/api/admin/reviews/:id/remove', requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const review = await getAsync('SELECT photo_filename FROM reviews WHERE id = ?', [id]);
      if (!review) return res.status(404).json({ error: 'Review not found.' });
      await runAsync(
        `UPDATE reviews SET status = 'removed', photo_filename = NULL, moderated_at = ?
         WHERE id = ?`,
        [new Date().toISOString(), id]
      );
      await runAsync(
        `UPDATE review_removal_requests SET status = 'resolved', resolved_at = ?
         WHERE review_id = ?`,
        [new Date().toISOString(), id]
      );
      if (review.photo_filename) {
        await fs.promises.unlink(path.resolve(uploadDirectory, path.basename(review.photo_filename))).catch(error => {
          if (error.code !== 'ENOENT') console.error('Unable to remove moderated review photo:', error);
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Unable to remove review:', error);
      res.status(500).json({ error: 'Unable to remove review.' });
    }
  });

  app.get('/api/admin/inventory', requireAdmin, async (req, res) => {
    try {
      res.json(await allAsync('SELECT * FROM ready_to_ship_inventory ORDER BY name'));
    } catch (error) {
      console.error('Unable to load inventory:', error);
      res.status(500).json({ error: 'Unable to load inventory.' });
    }
  });

  app.post('/api/admin/inventory', requireAdmin, async (req, res) => {
    try {
      const itemCode = String(req.body.itemCode || '').trim().toUpperCase();
      const name = String(req.body.name || '').trim();
      const productName = String(req.body.productName || '').trim();
      const details = String(req.body.details || '').trim();
      const priceCents = Math.round(Number(req.body.price) * 100);
      const quantity = Number(req.body.quantity);
      if (!/^[A-Z0-9_-]{2,40}$/.test(itemCode) || !name || name.length > 100 ||
          !HAT_PRODUCTS.has(productName) || details.length > 500 ||
          !Number.isInteger(priceCents) || priceCents < 1 ||
          !Number.isInteger(quantity) || quantity < 0 || quantity > 500) {
        return res.status(400).json({ error: 'Enter a valid item code, hat product, name, price, and stock quantity (0–500).' });
      }
      await runAsync(
        `INSERT INTO ready_to_ship_inventory
          (item_code, name, product_name, details, price_cents, quantity, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(item_code) DO UPDATE SET
           name = excluded.name, product_name = excluded.product_name,
           details = excluded.details, price_cents = excluded.price_cents,
           quantity = excluded.quantity, active = 1, updated_at = excluded.updated_at`,
        [itemCode, name, productName, details, priceCents, quantity, new Date().toISOString()]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Unable to save ready-to-ship inventory:', error);
      res.status(500).json({ error: 'Unable to save inventory item.' });
    }
  });

  app.delete('/api/admin/inventory/:id', requireAdmin, async (req, res) => {
    try {
      const result = await runAsync(
        'UPDATE ready_to_ship_inventory SET active = 0, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), Number(req.params.id)]
      );
      if (!result.changes) return res.status(404).json({ error: 'Inventory item not found.' });
      res.json({ success: true });
    } catch (error) {
      console.error('Unable to deactivate inventory item:', error);
      res.status(500).json({ error: 'Unable to remove inventory item.' });
    }
  });

  app.get('/api/admin/promotions', requireAdmin, async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
    try {
      const promotions = await stripe.promotionCodes.list({
        limit: 100,
        expand: ['data.promotion.coupon']
      });
      res.json(promotions.data.map(promotionCode => {
        const coupon = typeof promotionCode.promotion?.coupon === 'object'
          ? promotionCode.promotion.coupon
          : null;
        return {
          id: promotionCode.id,
          code: promotionCode.code,
          active: promotionCode.active,
          timesRedeemed: promotionCode.times_redeemed,
          maxRedemptions: promotionCode.max_redemptions,
          percentOff: coupon?.percent_off ?? null,
          amountOff: coupon?.amount_off == null ? null : coupon.amount_off / 100,
          expiresAt: promotionCode.expires_at
        };
      }));
    } catch (error) {
      console.error('Unable to load Stripe promotions:', error);
      res.status(500).json({ error: 'Unable to load promotions.' });
    }
  });

  app.post('/api/admin/promotions', requireAdmin, async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
    try {
      const code = String(req.body.code || '').trim().toUpperCase();
      const kind = req.body.kind;
      const value = Number(req.body.value);
      const maxRedemptions = req.body.maxRedemptions === '' || req.body.maxRedemptions == null
        ? null
        : Number(req.body.maxRedemptions);
      if (!/^[A-Z0-9-]{3,30}$/.test(code) ||
          !['amount', 'percent'].includes(kind) ||
          !Number.isFinite(value) || value <= 0 ||
          (kind === 'percent' && value > 100) ||
          (kind === 'amount' && Math.round(value * 100) > 100000) ||
          (maxRedemptions != null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 10000))) {
        return res.status(400).json({ error: 'Enter a code, fixed amount or percentage, and optional redemption limit.' });
      }
      const existing = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
      if (existing.data.length) return res.status(409).json({ error: 'An active promotion already uses that code.' });

      const couponParams = {
        duration: 'once',
        name: code,
        ...(kind === 'amount'
          ? { amount_off: Math.round(value * 100), currency: 'usd' }
          : { percent_off: value })
      };
      const coupon = await stripe.coupons.create(couponParams);
      const promotion = await stripe.promotionCodes.create({
        promotion: { type: 'coupon', coupon: coupon.id },
        code,
        ...(maxRedemptions == null ? {} : { max_redemptions: maxRedemptions })
      });
      res.status(201).json({ success: true, id: promotion.id, code: promotion.code });
    } catch (error) {
      console.error('Unable to create Stripe promotion:', error);
      res.status(500).json({ error: 'Unable to create promotion. Check the Stripe configuration and try again.' });
    }
  });

  app.patch('/api/admin/promotions/:id', requireAdmin, async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
    try {
      if (typeof req.body.active !== 'boolean') {
        return res.status(400).json({ error: 'Active must be true or false.' });
      }
      const promotion = await stripe.promotionCodes.update(req.params.id, { active: req.body.active });
      res.json({ success: true, active: promotion.active });
    } catch (error) {
      console.error('Unable to update Stripe promotion:', error);
      res.status(500).json({ error: 'Unable to update promotion.' });
    }
  });

  app.get('/api/admin/rewards', requireAdmin, async (req, res) => {
    try {
      const [customers, activity, referralHistory, discounts] = await Promise.all([
        allAsync(
          `SELECT u.id, u.name, u.email, u.birthday_date,
                  COALESCE(SUM(l.points), 0) AS points
           FROM users u LEFT JOIN rewards_ledger l ON l.user_id = u.id
           GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`
        ),
        allAsync(
          `SELECT l.user_id, u.email, l.points, l.activity, l.created_at
           FROM rewards_ledger l JOIN users u ON u.id = l.user_id
           ORDER BY l.created_at DESC LIMIT 250`
        ),
        allAsync(
          `SELECT r.referrer_user_id, u.email AS referrer_email, r.referred_email,
                  r.order_id, r.status, r.created_at
           FROM referrals r JOIN users u ON u.id = r.referrer_user_id
           ORDER BY r.created_at DESC LIMIT 250`
        ),
        allAsync(
          `SELECT d.user_id, u.email, d.code, d.kind, d.status, d.created_at, d.redeemed_at
           FROM reward_discounts d JOIN users u ON u.id = d.user_id
           ORDER BY d.created_at DESC LIMIT 250`
        )
      ]);
      res.json({ customers, activity, referrals: referralHistory, discounts });
    } catch (error) {
      console.error('Unable to load admin rewards activity:', error);
      res.status(500).json({ error: 'Unable to load reward activity.' });
    }
  });

  app.post('/api/admin/rewards/:userId/adjust', requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      const points = Number(req.body.points);
      const reason = String(req.body.reason || '').trim();
      if (!Number.isInteger(userId) || userId <= 0 ||
          !Number.isInteger(points) || points === 0 || Math.abs(points) > 5000 ||
          !reason || reason.length > 300) {
        return res.status(400).json({ error: 'Enter an adjustment from -5,000 to 5,000 points and a reason of up to 300 characters.' });
      }
      await transactionAsync(async ({ runAsync: txRun, getAsync: txGet }) => {
        const user = await txGet('SELECT id FROM users WHERE id = ?', [userId]);
        if (!user) throw new Error('CUSTOMER_NOT_FOUND');
        const current = await txGet(
          'SELECT COALESCE(SUM(points), 0) AS balance FROM rewards_ledger WHERE user_id = ?',
          [userId]
        );
        if (Number(current?.balance || 0) + points < 0) throw new Error('NEGATIVE_BALANCE');
        await txRun(
          `INSERT INTO rewards_ledger (user_id, points, activity, event_key, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, points, `Admin adjustment: ${reason}`, `admin:${userId}:${crypto.randomUUID()}`, new Date().toISOString()]
        );
      }).catch(error => {
        if (error.message === 'CUSTOMER_NOT_FOUND') error.statusCode = 404;
        if (error.message === 'NEGATIVE_BALANCE') error.statusCode = 409;
        throw error;
      });
      res.json({ success: true });
    } catch (error) {
      if (error.statusCode === 404) return res.status(404).json({ error: 'Customer not found.' });
      if (error.statusCode === 409) return res.status(409).json({ error: 'The adjustment cannot reduce the balance below zero.' });
      console.error('Unable to adjust customer points:', error);
      res.status(500).json({ error: 'Unable to adjust points.' });
    }
  });

  return {
    awardPoints,
    validateReferral: async (code, customerEmail) => {
      if (!code) return null;
      const referral = await getAsync(
        `SELECT rc.user_id, u.email FROM referral_codes rc
         JOIN users u ON u.id = rc.user_id
         WHERE upper(rc.code) = upper(?)`,
        [String(code).trim()]
      );
      if (!referral || referral.email.toLowerCase() === String(customerEmail).toLowerCase()) return null;
      return referral;
    },
    getDiscount: async (code, userId) => {
      const discount = await getAsync(
        `SELECT * FROM reward_discounts
         WHERE upper(code) = upper(?) AND user_id = ? AND status = 'available'`,
        [String(code).trim(), userId]
      );
      if (!discount) return null;
      if (discount.kind === 'birthday_bogo') return { ...discount, couponId: null };
      let couponId = discount.stripe_coupon_id;
      if (!couponId) {
        const coupon = await stripe.coupons.create(
          {
            amount_off: discount.amount_cents,
            currency: 'usd',
            duration: 'once',
            max_redemptions: 1,
            name: 'Trae Rewards $5 redemption'
          },
          { idempotencyKey: `trae-reward-${discount.id}` }
        );
        couponId = coupon.id;
        await runAsync(
          'UPDATE reward_discounts SET stripe_coupon_id = ? WHERE id = ? AND stripe_coupon_id IS NULL',
          [couponId, discount.id]
        );
      }
      return { ...discount, couponId };
    },
    handlePaidOrder: async (order, session) => {
      const user = await getAsync('SELECT id FROM users WHERE lower(email) = lower(?)', [order.email]);
      const paidCents = Number(session.amount_total ?? Math.round(Number(order.total || 0) * 100));
      const earned = Math.floor(Math.max(0, paidCents) / 100) * 10;
      if (user && earned > 0) {
        await awardPoints(user.id, earned, 'Purchase points', `purchase:${order.id}`, order.id);
      }
      if (order.reward_discount_id) {
        await runAsync(
          `UPDATE reward_discounts SET status = 'redeemed', redeemed_at = ?, checkout_session_id = ?
           WHERE id = ? AND status IN ('available', 'reserved')`,
          [new Date().toISOString(), session.id, order.reward_discount_id]
        );
      }
      if (order.referral_code) {
        const referrer = await getAsync(
          `SELECT rc.user_id, u.email FROM referral_codes rc
           JOIN users u ON u.id = rc.user_id
           WHERE upper(rc.code) = upper(?)`,
          [order.referral_code]
        );
        if (referrer && referrer.email.toLowerCase() !== order.email.toLowerCase()) {
          await transactionAsync(async ({ runAsync: txRun }) => {
             const result = await txRun(
               `INSERT INTO referrals
                 (referrer_user_id, referred_email, referral_code, order_id, status, created_at)
                VALUES (?, lower(?), ?, ?, 'qualified', ?)
                ON CONFLICT(referred_email) DO NOTHING`,
               [referrer.user_id, order.email, order.referral_code, order.id, new Date().toISOString()]
             );
             if (result.changes) {
               await txRun(
                 `INSERT INTO rewards_ledger (user_id, points, activity, event_key, order_id, created_at)
                  VALUES (?, 200, 'Friend referral purchase', ?, ?, ?)
                  ON CONFLICT(event_key) DO NOTHING`,
                 [referrer.user_id, `referral:${order.id}`, order.id, new Date().toISOString()]
               );
             }
          });
          const referralReward = await getAsync(
             `SELECT id FROM referrals WHERE order_id = ? AND referrer_user_id = ? AND notified_at IS NULL`,
             [order.id, referrer.user_id]
          );
          if (referralReward) {
             const result = await resend.emails.send({
               from: 'orders@stitchedbytrae.com',
               replyTo: 'stitchedbytrae@gmail.com',
              to: referrer.email,
              subject: 'You earned Trae Rewards points!',
              html: `<p>Your friend made a qualifying purchase. 200 Trae Rewards points have been added to your account.</p><p><a href="${siteUrl}/account#rewards">View Trae Rewards</a></p>`
            });
            if (result.error) throw new Error(`Referral reward email failed: ${result.error.message}`);
            await runAsync('UPDATE referrals SET notified_at = ? WHERE id = ?', [new Date().toISOString(), referralReward.id]);
          }
        }
      }
      await runAsync(
        `UPDATE inventory_reservations SET status = 'consumed'
         WHERE order_id = ? AND status = 'reserved'`,
        [order.id]
      );
    },
    handleRefund: async (charge, eventId) => {
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
      if (!paymentIntentId) return;
      const order = await getAsync('SELECT id, email FROM orders WHERE payment_intent_id = ?', [paymentIntentId]);
      if (!order) return;
      const user = await getAsync('SELECT id FROM users WHERE lower(email) = lower(?)', [order.email]);
      if (!user) return;
      await transactionAsync(async ({ runAsync: txRun, getAsync: txGet }) => {
        const purchase = await txGet(
          'SELECT points FROM rewards_ledger WHERE event_key = ? AND user_id = ?',
          [`purchase:${order.id}`, user.id]
        );
        if (!purchase?.points) return;
        const totalReversed = await txGet(
          `SELECT COALESCE(SUM(-points), 0) AS points FROM rewards_ledger
           WHERE order_id = ? AND activity = 'Purchase refund reversal'`,
          [order.id]
        );
        const targetReversal = Math.min(
          purchase.points,
          Math.floor(purchase.points * Math.min(Number(charge.amount_refunded || 0) / Math.max(Number(charge.amount || 0), 1), 1))
        );
        const additionalReversal = targetReversal - Number(totalReversed?.points || 0);
        if (additionalReversal > 0) {
          await txRun(
            `INSERT INTO rewards_ledger (user_id, points, activity, event_key, order_id, created_at)
             VALUES (?, ?, 'Purchase refund reversal', ?, ?, ?)
             ON CONFLICT(event_key) DO NOTHING`,
            [user.id, -additionalReversal, `refund:${eventId}`, order.id, new Date().toISOString()]
          );
        }
      });
    },
    releaseCheckout: async session => {
      const orderId = Number(session.metadata?.orderId);
      if (!orderId) return;
      await transactionAsync(async ({ runAsync: txRun, allAsync: txAll }) => {
        const reservations = await txAll(
          `SELECT inventory_id, quantity FROM inventory_reservations
           WHERE order_id = ? AND status = 'reserved'`,
          [orderId]
        );
        for (const reservation of reservations) {
          const result = await txRun(
            `UPDATE inventory_reservations SET status = 'released'
             WHERE order_id = ? AND inventory_id = ? AND status = 'reserved'`,
            [orderId, reservation.inventory_id]
          );
          if (result.changes) {
            await txRun(
              'UPDATE ready_to_ship_inventory SET quantity = quantity + ?, updated_at = ? WHERE id = ?',
              [reservation.quantity, new Date().toISOString(), reservation.inventory_id]
            );
          }
        }
        await txRun(
          `UPDATE reward_discounts SET status = 'available', checkout_session_id = NULL
           WHERE id = (SELECT reward_discount_id FROM orders WHERE id = ?)
             AND status = 'reserved'`,
          [orderId]
        );
      });
    },
    scheduleReviewRequest: async order => {
      const user = await getAsync('SELECT id FROM users WHERE lower(email) = lower(?)', [order.email]);
      if (!user) return;
      const due = new Date(order.delivered_at || Date.now());
      due.setUTCDate(due.getUTCDate() + REVIEW_EMAIL_DELAY_DAYS);
      await runAsync(
        `INSERT INTO review_requests (order_id, user_id, due_at)
         VALUES (?, ?, ?) ON CONFLICT(order_id) DO NOTHING`,
        [order.id, user.id, due.toISOString()]
      );
    },
    processScheduledEmails: async () => {
      const now = new Date().toISOString();
      const staleClaim = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const dueReviews = await allAsync(
        `SELECT rr.id, rr.order_id, rr.user_id, u.email, u.name, o.order_number
         FROM review_requests rr
         JOIN users u ON u.id = rr.user_id
         JOIN orders o ON o.id = rr.order_id
         WHERE rr.sent_at IS NULL AND rr.due_at <= ?
           AND (rr.claimed_at IS NULL OR rr.claimed_at < ?) AND o.status = 'delivered'
           AND u.review_email_opt_in = 1`,
        [now, staleClaim]
      );
      for (const request of dueReviews) {
        const claim = await runAsync(
          `UPDATE review_requests SET claimed_at = ?
           WHERE id = ? AND sent_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?)`,
          [now, request.id, staleClaim]
        );
        if (!claim.changes) continue;
        try {
          const result = await resend.emails.send({
            from: 'orders@stitchedbytrae.com',
            replyTo: 'stitchedbytrae@gmail.com',
            to: request.email,
            subject: `How was your order ${request.order_number}?`,
            html: `<p>Hi ${escapeHtml(request.name)},</p><p>Your order has been delivered. We would love to hear what you think.</p><p><a href="${siteUrl}/account#reviews">Leave a verified review</a></p>`
          });
          if (result.error) throw new Error(result.error.message);
          await runAsync('UPDATE review_requests SET sent_at = ? WHERE id = ?', [now, request.id]);
        } catch (error) {
          await runAsync('UPDATE review_requests SET claimed_at = NULL WHERE id = ?', [request.id]);
          throw new Error(`Review email failed for order ${request.order_number}: ${error.message}`);
        }
      }
      await issueBirthdayRewards({ allAsync, getAsync, runAsync, transactionAsync, siteUrl, resend });
    }
  };
}

async function issueBirthdayRewards({ allAsync, getAsync, runAsync, transactionAsync, siteUrl, resend }) {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const year = now.getUTCFullYear();
  const users = await allAsync(
    `SELECT id, name, email, marketing_email_opt_in FROM users
     WHERE birthday_set_at IS NOT NULL AND substr(birthday_date, 6, 2) = ?`,
    [month]
  );
  for (const user of users) {
    const reward = await transactionAsync(async ({ runAsync: txRun, getAsync: txGet }) => {
      let event = await txGet(
        `SELECT discount_code, email_sent_at, discount_notified_at
         FROM birthday_reward_events WHERE user_id = ? AND reward_year = ?`,
        [user.id, year]
      );
      if (!event) {
        await txRun(
          `INSERT INTO rewards_ledger (user_id, points, activity, event_key, created_at)
           VALUES (?, 100, 'Birthday bonus', ?, ?)
           ON CONFLICT(event_key) DO NOTHING`,
          [user.id, `birthday:${user.id}:${year}`, now.toISOString()]
        );
        await txRun(
          `INSERT INTO birthday_reward_events
            (user_id, reward_year, birthday_month, processed_at, email_sent_at)
           VALUES (?, ?, ?, ?, ?)`,
          [user.id, year, now.getUTCMonth() + 1, now.toISOString(), user.marketing_email_opt_in ? null : now.toISOString()]
        );
        event = {
          discount_code: null,
          email_sent_at: user.marketing_email_opt_in ? null : now.toISOString(),
          discount_notified_at: null
        };
      }

      if (!event.discount_code) {
        const eligibleInventory = await txGet(
          `SELECT free.id FROM ready_to_ship_inventory AS free
           WHERE free.active = 1 AND free.quantity > 0
             AND free.product_name IN ('Beanie', 'Bucket Hat', 'Ruffle Bucket Hat')
             AND EXISTS (
               SELECT 1 FROM ready_to_ship_inventory AS paid
               WHERE paid.active = 1
                 AND paid.product_name IN ('Beanie', 'Bucket Hat', 'Ruffle Bucket Hat')
                 AND paid.price_cents >= free.price_cents
                 AND paid.quantity >= CASE WHEN paid.id = free.id THEN 2 ELSE 1 END
             )
           ORDER BY free.price_cents LIMIT 1`
        );
        if (eligibleInventory) {
          const code = makeCode('BDAY');
          await txRun(
            `INSERT INTO reward_discounts (code, user_id, kind, inventory_id, created_at)
             VALUES (?, ?, 'birthday_bogo', ?, ?)`,
            [code, user.id, eligibleInventory.id, now.toISOString()]
          );
          await txRun(
            `UPDATE birthday_reward_events SET discount_code = ? WHERE user_id = ? AND reward_year = ?`,
            [code, user.id, year]
          );
          event.discount_code = code;
        }
      }
      return event;
    });
    if (!reward.email_sent_at && user.marketing_email_opt_in) {
      const result = await resend.emails.send({
        from: 'orders@stitchedbytrae.com',
        replyTo: 'stitchedbytrae@gmail.com',
        to: user.email,
        subject: 'A birthday treat from Stitched By Trae',
        html: `<p>Happy birthday month, ${escapeHtml(user.name)}! You received 100 Trae Rewards points. ${reward.discount_code ? 'Your birthday BOGO reward is waiting in My Account → Trae Rewards.' : 'Your 100 bonus points are waiting in My Account → Trae Rewards.'}</p><p><a href="${siteUrl}/account#rewards">View Trae Rewards</a></p>`
      });
      if (result.error) throw new Error(`Birthday email failed for customer ${user.id}: ${result.error.message}`);
      await runAsync(
        `UPDATE birthday_reward_events
         SET email_sent_at = ?, discount_notified_at = CASE WHEN discount_code IS NOT NULL THEN ? ELSE discount_notified_at END
         WHERE user_id = ? AND reward_year = ?`,
        [new Date().toISOString(), reward.discount_code ? new Date().toISOString() : null, user.id, year]
      );
    } else if (reward.discount_code && !reward.discount_notified_at && user.marketing_email_opt_in) {
      const result = await resend.emails.send({
        from: 'orders@stitchedbytrae.com',
        replyTo: 'stitchedbytrae@gmail.com',
        to: user.email,
        subject: 'Your birthday BOGO reward is ready!',
        html: `<p>Happy birthday month, ${escapeHtml(user.name)}! Your birthday BOGO is now available in My Account → Trae Rewards. Buy one eligible ready-to-ship hat and get another of equal or lesser value free.</p><p><a href="${siteUrl}/account#rewards">View Trae Rewards</a></p>`
      });
      if (result.error) throw new Error(`Birthday BOGO email failed for customer ${user.id}: ${result.error.message}`);
      await runAsync(
        'UPDATE birthday_reward_events SET discount_notified_at = ? WHERE user_id = ? AND reward_year = ?',
        [new Date().toISOString(), user.id, year]
      );
    }
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
