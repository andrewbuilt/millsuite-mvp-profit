-- ============================================================================
-- 050 — Stripe subscription columns on orgs
-- ============================================================================
-- Wires the existing /api/checkout + /api/stripe-webhook stubs into a real
-- billing flow. Until now, signup created an org with a `plan` set but no
-- payment state; the webhook stub referenced stripe_customer_id /
-- stripe_subscription_id columns that didn't exist.
--
-- Columns added:
--   stripe_customer_id      — Stripe `cus_...` reference. Populated by the
--                             checkout.session.completed webhook.
--   stripe_subscription_id  — Stripe `sub_...` reference. Same source.
--   plan_status             — pending | active | past_due | canceled |
--                             incomplete. Drives the pay-required banner /
--                             gate. Existing rows default to 'active' so the
--                             two beta testers don't get locked out at
--                             migration time; new rows from /api/auth/setup
--                             explicitly write 'pending'.
--   current_period_end      — when the current paid period ends. Used to
--                             show "next billing date" on Settings → Billing
--                             and to drive grace-period UX for past_due.
--   seats                   — billed seat count for this subscription.
--                             Mirrors line_items[0].quantity on the Stripe
--                             side. Per-tier minimums enforced in the
--                             checkout route, not at the DB level (lib/
--                             feature-flags.ts is the source of truth for
--                             PLAN_SEAT_MINIMUM).
--   cancel_at_period_end    — set to true when a customer cancels via the
--                             Customer Portal. Subscription stays 'active'
--                             until current_period_end, then the
--                             customer.subscription.deleted webhook flips
--                             plan_status='canceled'.
--
-- Indexes:
--   Partial unique on stripe_customer_id and stripe_subscription_id (where
--   not null) so the webhook can look up the org by either reference
--   without ambiguity. Partial because most existing rows are null.
--
-- Notes:
--   `seats` defaults to 1 for backfill of existing orgs; the next checkout
--   will overwrite this from the Stripe quantity. No data loss for the
--   beta orgs because they're not on a paid plan yet.
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text NULL,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text NULL,
  ADD COLUMN IF NOT EXISTS plan_status            text NOT NULL DEFAULT 'active'
    CHECK (plan_status IN ('pending','active','past_due','canceled','incomplete')),
  ADD COLUMN IF NOT EXISTS current_period_end     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS seats                  int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end   boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_orgs_stripe_customer
  ON public.orgs(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_orgs_stripe_subscription
  ON public.orgs(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
