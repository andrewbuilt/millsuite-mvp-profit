-- ============================================================================
-- 054 — Webhook hardening: event idempotency + seat-downgrade surfacing
-- ============================================================================
-- L2 — stripe_events: Stripe delivers webhooks at-least-once, so the same
-- event can arrive twice. Most handlers set fixed values (idempotent), but
-- handleCheckoutCompleted fires the Klaviyo activation event, which would
-- re-send the welcome flow on a redelivery. We record each processed
-- event.id and skip anything we've already handled.
--
-- L1 — orgs.pending_seat_downgrade: when a customer lowers their seat
-- count in the Stripe Customer Portal below the number of users they
-- actually have, the webhook refuses to drop orgs.seats (so nobody loses
-- access) — but Stripe is now billing the lower count. That gap was
-- invisible. We stash the attempted seat count here so Settings → Billing
-- can show a "remove N users to finish your downgrade" banner. Cleared
-- when the downgrade later succeeds or seats go back up.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.stripe_events;
--   ALTER TABLE public.orgs DROP COLUMN IF EXISTS pending_seat_downgrade;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id   text PRIMARY KEY,
  type       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS pending_seat_downgrade integer NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
