# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start local dev server at http://localhost:5173
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
```

There is no lint, test, or type-check script. The project is plain JavaScript (no TypeScript).

## What This Is

C8 Tickets is a single-venue ticket sales platform for **Crooked 8** (a bar/venue in Kuna, ID). Customers browse events, select tickets, pay via Stripe, and receive a QR-code confirmation email. A password-protected admin section lets staff manage events, view orders, and check in attendees.

## Architecture

**Single `App.jsx` — no router library.** All views, state, business logic, and styles live in `src/App.jsx`. Routing is a `view` state variable (strings: `"home"`, `"detail"`, `"checkout"`, `"ticket"`, `"login"`, `"admin"`, `"terms"`, `"privacy"`, etc.).

**State management:** All state in a single top-level `useState` tree inside `App`. A custom `useStorage` hook fetches Supabase data on mount (tenants, events with ticket types, orders).

**Styling:** All CSS is a single template-literal string (`CSS`) injected as a `<style>` tag inside the JSX. No Tailwind, no CSS modules, no external CSS files.

**Multi-tenancy:** The DB schema has a `tenants` table with `tenant_id` FKs on events/orders, but the app is hardcoded to one tenant via `CROOKED_8_TENANT_ID` in `src/constants.js`.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + Vite 5 |
| Backend/DB | Supabase (Postgres + Auth + Storage) |
| Payments | Stripe (Elements + Payment Intents) |
| Email | Resend |
| Serverless API | Vercel Serverless Functions (`/api/`) |
| Deployment | Vercel (auto-deploys `main`) |

## Payment Flow

1. User selects tickets → client POSTs to `/api/create-payment-intent.js`
2. Vercel function calculates fees and creates a Stripe `PaymentIntent`, returns `clientSecret`
3. Stripe `<Elements>` renders the payment form
4. On success: order written to Supabase (`orders` + `order_items`), ticket quantity decremented via RPC `increment_sold`, confirmation email sent via `/api/send-confirmation.js`

**Fee structure** (in `/api/create-payment-intent.js`): 6% Idaho sales tax + $2.00/ticket service fee + 3.5% + $0.30 processing fee.

## Key Files

- `src/App.jsx` — entire application (all views, state, styles)
- `src/constants.js` — `CROOKED_8_TENANT_ID` UUID
- `src/lib/supabase.js` — Supabase client singleton
- `api/create-payment-intent.js` — Stripe PaymentIntent creation + fee calculation
- `api/send-confirmation.js` — order confirmation email via Resend

## Environment Variables

**Client-side (Vite, prefixed `VITE_`):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_STRIPE_PUBLISHABLE_KEY`

**Server-side (Vercel functions only, never exposed to browser):**
- `STRIPE_SECRET_KEY`
- `RESEND_API_KEY`

Set in `.env.local` locally; configure in Vercel project settings for production.

## Supabase Schema

| Table | Key Columns |
|---|---|
| `tenants` | `id`, `name`, `slug`, `address`, `contact_phone`, `contact_email`, `website`, `owner_name`, `active` |
| `events` | `id`, `tenant_id`, `title`, `description`, `category`, `event_date`, `doors_open`, `image_url`, `focal_x`, `focal_y`, `venue_name`, `is_published`, `addons` (JSONB), `checkout_notice`, `checkout_notice_required` |
| `ticket_types` | `id`, `event_id`, `name`, `price`, `door_price`, `quantity_total`, `quantity_sold`, `physical_qty` |
| `orders` | `id`, `tenant_id`, `event_id`, `buyer_name`, `buyer_email`, `buyer_phone`, `status`, `total_amount`, `stripe_payment_intent_id`, `source`, `checked_in`, `created_at` |
| `order_items` | `id`, `order_id`, `ticket_type_id`, `ticket_type_name`, `quantity`, `unit_price` |
| `tickets` | `id`, `order_id`, `event_id`, `ticket_type_name`, `ticket_number`, `status`, `checked_in_at` |
| `tenant_users` | `id`, `user_id`, `tenant_id`, `role`, `created_at` |
| `promo_codes` | `id`, `tenant_id`, `event_id`, `code`, `discount_type`, `discount_value`, `max_uses`, `uses_count`, `expires_at`, `active` |
| `waitlist_entries` | `id`, `event_id`, `tenant_id`, `name`, `email`, `created_at` |
| `venue_payouts` | `id`, `tenant_id`, `amount`, `notes`, `paid_at`, `created_at` |

Storage bucket: `event-images` (public URLs stored in `events.image_url`)
RPC: `increment_sold(tid, qty)` — increments `quantity_sold` on a ticket type
RPC: `decrement_sold(tid, qty)` — decrements `quantity_sold` on cancellation

## Row Level Security

RLS is enabled on all tables. Policies implemented 2026-06-22.

**Helper function:** `public.get_tenant_id()` — returns the calling user's `tenant_id` from `tenant_users` by `auth.uid()`. Used in all tenant-scoped policies. Runs as SECURITY INVOKER (not DEFINER) so `auth.uid()` resolves correctly.

**Policy summary per table:**
- `tenants` — public SELECT; authenticated write scoped to own tenant
- `events` — anon SELECT (published only); authenticated ALL scoped to own tenant
- `ticket_types` — public SELECT; authenticated write scoped via events.tenant_id
- `orders` — authenticated SELECT/INSERT/UPDATE scoped to own tenant; no anon access (webhook uses service role key)
- `order_items` — authenticated SELECT/INSERT/UPDATE scoped via orders.tenant_id; no anon access
- `tickets` — authenticated ALL scoped via orders.tenant_id; no anon access
- `promo_codes` — authenticated ALL scoped to own tenant
- `venue_payouts` — authenticated ALL scoped to own tenant
- `waitlist_entries` — anon INSERT; authenticated ALL scoped to own tenant
- `tenant_users` — users can SELECT their own row only

**Important:** All staff users (admin, venue, gate roles) must have a row in `tenant_users` linking their `auth.uid()` to their `tenant_id`. Without this, they will see no data.

## Known Quirks

- `dist/` is committed to the repo (Vercel also builds independently)
- The inline `QRCode` component in `App.jsx` renders a pseudo-random visual, not a real scannable QR. The email confirmation uses `api.qrserver.com` for a real QR code from the order UUID
- `public/privacy.html` and `public/terms.html` exist but are unused — Terms and Privacy render inline in the SPA
- Auth is admin-only via Supabase email/password; customers do not create accounts
