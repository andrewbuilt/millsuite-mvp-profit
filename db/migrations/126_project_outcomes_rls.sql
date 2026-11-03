-- ============================================================================
-- 126 — project_outcomes: turn RLS ON (2026-11-03)
-- ============================================================================
-- ⛔ FOUND BY rls-audit AFTER 125: `project_outcomes` was READABLE BY ANYONE
-- with the public key (7 rows · 25 cols — closed jobs' estimated vs actual
-- price, labor cost, margin). No migration ever created this table, so no
-- migration ever enabled RLS on it; it sat empty (the audit can't test an empty
-- table) until jobs started closing. Same failure mode as 100/104: a table
-- nobody was looking at.
--
-- Readers: /reports (browser client, filters org_id) → the org SELECT policy
-- below. Writers: /api/project-outcome (service role — bypasses RLS) → no
-- write policy, so the browser can't write outcomes at all.
--
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.project_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_outcomes_select ON public.project_outcomes;
CREATE POLICY project_outcomes_select ON public.project_outcomes FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
