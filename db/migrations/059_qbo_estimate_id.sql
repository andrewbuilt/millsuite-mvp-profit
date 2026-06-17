-- ============================================================================
-- 059 — Store the QuickBooks estimate id/number on projects (QB-mode push)
-- ============================================================================
-- qbo_invoice_id already lives on cash_flow_receivables (per-milestone, from
-- migration 001). Estimates are project-level, so the QB estimate id + doc
-- number go on projects. The estimate push (Chunk 5) records what it created in
-- QB so we can reference/reconcile it later.
--
-- Idempotent: safe to re-run.
--
-- Rollback:
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS qbo_estimate_id;
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS qbo_estimate_number;
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS qbo_estimate_id text,
  ADD COLUMN IF NOT EXISTS qbo_estimate_number text;

NOTIFY pgrst, 'reload schema';

COMMIT;
