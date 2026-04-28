-- ============================================================================
-- 048 — project_month_allocations.source ('auto' | 'manual')
-- ============================================================================
-- Distinguishes operator-placed rows (drag-drop on /capacity) from rows
-- the auto-seed pass writes from the schedule's department_allocations.
-- The auto-seed never overwrites a manual row — operator placement always
-- wins. A manual drag flips source back to 'manual' so the auto pass
-- treats it as pinned.
--
-- Existing rows pre-date this column. They were all created via manual
-- drag-drop on the capacity page (no auto-seed existed before this PR),
-- so the 'manual' default leaves them in place and protects them from
-- being overwritten on the next seed pass.
-- ============================================================================

BEGIN;

ALTER TABLE public.project_month_allocations
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('auto', 'manual'));

CREATE INDEX IF NOT EXISTS idx_pma_project_source
  ON public.project_month_allocations(project_id, source);

NOTIFY pgrst, 'reload schema';

COMMIT;
