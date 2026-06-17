-- ============================================================================
-- 057 — Per-org invoicing backend (Internal or QuickBooks)
-- ============================================================================
-- A shop picks ONE invoicing backend:
--   'internal'   — MillSuite's built-in invoices (today's behavior; default).
--   'quickbooks' — estimates/invoices are pushed to QuickBooks instead.
--
-- This only controls WHERE an estimate/invoice is created. Cash flow stays
-- milestone-based in BOTH modes (cash_flow_receivables + the QB payment
-- watcher), so nothing about receivables/AR changes here.
--
-- Read everywhere via the single predicate invoicingMode(org) in
-- lib/org-settings.ts, so UI and server never drift.
--
-- This is Chunk 1 of the invoicing-backend work — the SETTING only. The QB
-- OAuth handshake and the push paths land in later chunks; nothing pushes yet.
--
-- Idempotent: safe to re-run. Existing rows pick up the 'internal' default.
--
-- Rollback:
--   ALTER TABLE public.orgs DROP CONSTRAINT IF EXISTS orgs_invoicing_mode_check;
--   ALTER TABLE public.orgs DROP COLUMN IF EXISTS invoicing_mode;
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS invoicing_mode text NOT NULL DEFAULT 'internal';

-- Drop-then-add so the named constraint is idempotent on re-run (matches the
-- pattern used by orgs_plan_status_check in migration 056).
ALTER TABLE public.orgs DROP CONSTRAINT IF EXISTS orgs_invoicing_mode_check;
ALTER TABLE public.orgs
  ADD CONSTRAINT orgs_invoicing_mode_check
  CHECK (invoicing_mode IN ('internal', 'quickbooks'));

NOTIFY pgrst, 'reload schema';

COMMIT;
