-- ============================================================================
-- 123 — Draws typed in DOLLARS stay put (2026-10-28)
-- ============================================================================
-- The draw editors gained a Percent | Dollars toggle (retainage is the real
-- case: people think "$17,256 retainage", not "10%"). Under the
-- settle-and-spread rule (3239cf0) every OPEN draw is re-derived from what the
-- contract still owes — after a payment, after a change order. A hand-typed
-- dollar amount must NOT be quietly re-spread, so it's pinned:
--
--   cash_flow_receivables.amount_pinned — true = typed in dollars; the spread
--   skips it. Unpinned open draws absorb what's left. If every open draw is
--   pinned and they don't foot to the contract, the board shows the
--   directional drift notice instead of moving anyone's number.
--
-- Default false: every existing row keeps behaving exactly as today.
-- Idempotent. No RLS change (column on an org-policied table).
-- ============================================================================

BEGIN;

ALTER TABLE public.cash_flow_receivables
  ADD COLUMN IF NOT EXISTS amount_pinned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cash_flow_receivables.amount_pinned IS
  'Typed in dollars in a draw editor — the settle-and-spread re-derivation skips it (lib/payment-ledger reconcileProject). (123)';

COMMIT;

NOTIFY pgrst, 'reload schema';
