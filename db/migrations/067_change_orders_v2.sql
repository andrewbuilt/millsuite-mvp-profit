-- ============================================================================
-- 067 — Change Orders v2 (Andrew's 2026-07-20 flow)
-- ============================================================================
-- The original change_orders table (002) modeled a CO as a line-snapshot diff
-- with a manual QB handoff. Andrew's rescoped flow enters material + labor cost
-- directly, prices through the project margins, and (for priced COs) bills to a
-- rolling per-project CO invoice. This adds the columns that flow needs; the
-- existing columns (original_line_snapshot / proposed_line jsonb, net_change,
-- no_price_change, state, client_response_note) are reused.
--
--   co_number                — sequential per project (CO-01, CO-02 …)
--   material_cost            — entered material cost of the change
--   labor_cost               — entered labor cost of the change
--   client_price             — priced amount billed to the client (0 = free CO)
--   internal_cost_delta      — free-CO margin erosion (free to client, not to us)
--   drawing_revision_required— flag (we surface it; we don't edit drawings)
--   co_invoice_id            — the rolling CO invoice this CO was billed onto
--
-- State reuses the existing co_state enum (draft / sent_to_client / approved /
-- rejected / void), relabeled in the UI as draft / sent / accepted / declined.
--
-- Idempotent. Run against prod Supabase before deploying the code that reads it.
-- ============================================================================

ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS co_number                 int,
  ADD COLUMN IF NOT EXISTS material_cost             numeric,
  ADD COLUMN IF NOT EXISTS labor_cost                numeric,
  ADD COLUMN IF NOT EXISTS client_price              numeric,
  ADD COLUMN IF NOT EXISTS internal_cost_delta       numeric,
  ADD COLUMN IF NOT EXISTS drawing_revision_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS co_invoice_id             uuid REFERENCES public.client_invoices(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
