-- ============================================================================
-- 106 — cash_flow_receivables.change_order_id
-- ============================================================================
-- ⛔ THE BUG THIS CLOSES. Approving a change order grows `projects.bid_total`
-- (via `recomputeProjectBidTotal`) but writes NOTHING to the draw schedule. So
-- `reconcileProject` finds the contract larger than the stored draws and does
-- `last.scheduled += delta` — its own comment: "The contract grew (a change
-- order) — the FINAL draw absorbs it whole."
--
-- The aggregate was right. The presentation was a lie by omission:
--   · the stored rows stopped summing to the contract
--   · the client-facing final draw grew with no line item explaining it
--   · ⛔ a CO approved AFTER the final draw was paid silently re-opened a
--     settled draw, because `last.scheduled` grows regardless of `covered`
--
-- Andrew, 2026-09-13: an approved PRICED change order gets its own labelled
-- draw row. A CREDIT keeps shrinking the end — a negative line on a
-- client-facing payment schedule is confusing, and the existing
-- shrink-from-the-end branch already refuses to push a draw below what's been
-- paid against it.
--
-- ⛔ THE UNIQUE INDEX IS THE IDEMPOTENCY, AND IT IS NOT DECORATION.
-- `approveCo` runs its steps as separate best-effort blocks wrapped in
-- try/catch, and the CO card can be re-approved. Without this index a retried
-- approval writes a SECOND draw for the same change order, quietly
-- double-counting money the client owes. Partial (`WHERE ... IS NOT NULL`) so
-- the hundreds of ordinary draws, which have no CO, are unaffected.
--
-- ON DELETE SET NULL, not CASCADE: deleting a change order must not delete a
-- draw the shop may already have invoiced against. The row survives as an
-- ordinary draw and can be edited or cancelled by hand.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS uniq_cash_flow_receivables_change_order;
--   ALTER TABLE public.cash_flow_receivables DROP COLUMN IF EXISTS change_order_id;
-- ============================================================================

BEGIN;

ALTER TABLE public.cash_flow_receivables
  ADD COLUMN IF NOT EXISTS change_order_id uuid NULL
    REFERENCES public.change_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_flow_receivables_change_order
  ON public.cash_flow_receivables(change_order_id)
  WHERE change_order_id IS NOT NULL;

COMMENT ON COLUMN public.cash_flow_receivables.change_order_id IS
  'The approved change order this draw bills. Unique — one draw per CO, which is what makes a retried approval idempotent.';

COMMIT;

NOTIFY pgrst, 'reload schema';
