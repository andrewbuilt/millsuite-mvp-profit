-- ============================================================================
-- Migration 031 — RLS policies for cash_flow_receivables
-- ============================================================================
-- Same situation migrations 018 + 024 called out: this table was created in
-- 001 but never shipped RLS in the repo. Symptom on the project page:
--   * MilestoneBuilder Save click flashes the success toast.
--   * loadMilestones returns an empty array on the next mount.
--   * Reload erases the user's composed schedule (the rollup card reads
--     "no milestones yet" and the QB modal falls back to its 30% default).
--
-- Likely cause: the Supabase dashboard has RLS enabled with at most a
-- partial policy (matching what we saw on rate_book_*); INSERT silently
-- succeeds with the service role used during prior dev, but the
-- authenticated session reads see zero rows because no SELECT policy
-- covers them. Either way the repo source-of-truth is wrong.
--
-- Policy model: authenticated role, scoped via EXISTS on the parent
-- project's org_id (the project is the authoritative org owner; the
-- receivable's own org_id column was nullable in 001 and we don't want
-- a NULL to bypass the check). Matches 017 / 018 / 024 precedent.
-- Tighten to membership-scoped RLS later when cross-org sharing actually
-- exists.
-- ============================================================================

BEGIN;

ALTER TABLE public.cash_flow_receivables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_flow_receivables_select_authenticated ON public.cash_flow_receivables;
DROP POLICY IF EXISTS cash_flow_receivables_insert_authenticated ON public.cash_flow_receivables;
DROP POLICY IF EXISTS cash_flow_receivables_update_authenticated ON public.cash_flow_receivables;
DROP POLICY IF EXISTS cash_flow_receivables_delete_authenticated ON public.cash_flow_receivables;

CREATE POLICY cash_flow_receivables_select_authenticated
  ON public.cash_flow_receivables FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.orgs o ON o.id = p.org_id
      WHERE p.id = cash_flow_receivables.project_id
    )
  );

CREATE POLICY cash_flow_receivables_insert_authenticated
  ON public.cash_flow_receivables FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.orgs o ON o.id = p.org_id
      WHERE p.id = cash_flow_receivables.project_id
    )
  );

CREATE POLICY cash_flow_receivables_update_authenticated
  ON public.cash_flow_receivables FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.orgs o ON o.id = p.org_id
      WHERE p.id = cash_flow_receivables.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.orgs o ON o.id = p.org_id
      WHERE p.id = cash_flow_receivables.project_id
    )
  );

CREATE POLICY cash_flow_receivables_delete_authenticated
  ON public.cash_flow_receivables FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.orgs o ON o.id = p.org_id
      WHERE p.id = cash_flow_receivables.project_id
    )
  );

COMMIT;
