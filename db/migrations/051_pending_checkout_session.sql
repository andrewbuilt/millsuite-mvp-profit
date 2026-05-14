-- ============================================================================
-- 051 — pending_checkout_session_id on orgs
-- ============================================================================
-- Idempotency for /api/checkout. Before this column, repeated clicks on
-- "Continue to payment" (whether because the customer was retrying or
-- the webhook silently failed) created a new Stripe Checkout Session
-- AND a new Stripe customer AND a new subscription on every call.
--
-- Real-world failure (May 10, 2026): a customer signed up for Pro+,
-- the webhook was misconfigured (www-prefix redirect), so the BillingGate
-- never cleared. The customer clicked "Continue to payment" five times
-- in twelve minutes, racking up five separate $595/mo subscriptions and
-- five different Stripe customers attached to the same email. The
-- webhook fix didn't backfill the duplicates — manual refunds did.
--
-- Fix: store the in-flight Checkout Session ID on the org. /api/checkout
-- retrieves it from Stripe on next call; if the session is still 'open',
-- redirect to it instead of creating a new one. Webhook clears the
-- column when activation succeeds so future signups can create fresh
-- sessions.
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS pending_checkout_session_id text NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
