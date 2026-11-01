# Stitched By Trae

## Run locally

Install dependencies with `npm install`, configure the environment below, then run `npm start`.

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe API key used for Checkout and promotion validation; prefer a restricted key with only required permissions |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the Stripe webhook endpoint |
| `RESEND_API_KEY` | Resend API key for account, order, review, referral, and birthday emails |
| `SITE_URL` | Public site origin used in email links and Stripe Checkout redirects |
| `DB_PATH` | SQLite database path; defaults to `/var/data/orders.db` |
| `REVIEW_UPLOAD_DIR` | Optional persistent directory for review photos; defaults to `.review-uploads` beside the database |
| `PORT` | HTTP port; defaults to `3000` |

On startup, the app applies the customer-feature SQLite schema migrations. Keep the database and review-photo directory on persistent storage and include both in backups. Only published, consented review photos are served through the app; the upload directory is not exposed as static content.
The app can start without Stripe credentials for local browsing, but payment and promotion endpoints remain unavailable until Stripe is configured.

Configure Stripe to send these events to `/stripe-webhook`:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`
- `charge.refunded`

The app also confirms paid orders through its success-page endpoint; webhook delivery remains necessary for reliable payment, expiration, and refund processing.

## Customer features

- Reviews are limited to products in a customer's delivered orders, one per product per order. Written text is required; photo uploads are optional and require the displayed consent. Four- and five-star reviews publish automatically; lower ratings are queued for admin moderation.
- Review-request emails are scheduled three days after delivery, subject to the customer's review-email preference. The scheduler checks due messages every 15 minutes.
- Trae Rewards points are recorded in a ledger. Purchase refunds reverse earned purchase points; birthday and referral rewards are issued once per customer/year or qualifying order.
- Customers save their birthday once. Birthday BOGO inventory is selected from active ready-to-ship hats managed in the admin dashboard; custom hats are not eligible.
- Checkout calculates prices and eligible discounts on the server. A reward redemption, birthday offer, or Stripe promotion code cannot be combined with another discount.

Use the admin dashboard to moderate reviews, respond to removal requests, manage ready-to-ship inventory, and administer customer rewards and Stripe promotions.
