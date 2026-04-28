-- ============================================================================
-- 049 — project_month_allocations dedupe + unique index
-- ============================================================================
-- PR #107's autoSeedProjectMonthAllocations had two race conditions that
-- could produce duplicate (project_id, month_date, source='auto') rows:
--
--   1. Concurrent schedule edits both ran the select-then-upsert path,
--      both saw "no existing auto row," both inserted.
--   2. The function's autoByMonth in-memory map keyed by month and
--      .set-overwrote — duplicates became invisible to subsequent
--      reconciliation passes and never got cleaned up.
--
-- Fix:
--   - One-time DELETE collapses any existing duplicates, keeping the
--     most recently created row per (project_id, month_date, source).
--     Hours / dept_hours of the survivor are preserved as-is — the
--     auto-seed will overwrite on the next call regardless.
--   - Unique index on (project_id, month_date, source) prevents future
--     races. Auto + manual for the same month are both allowed (one of
--     each kind), so the function can preserve a manual pin while still
--     tracking what the schedule says.
-- ============================================================================

BEGIN;

-- One-time cleanup. ROW_NUMBER() partitions over the duplicate set; rn=1
-- is the survivor (newest first, breaking ties by id), everything else
-- gets deleted.
DELETE FROM public.project_month_allocations a
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY project_id, month_date, source
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.project_month_allocations
) keepers
WHERE a.id = keepers.id
  AND keepers.rn > 1;

-- Race-proof the upsert path. supabase-js .upsert(onConflict=...) needs
-- a matching unique constraint or unique index to resolve to UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pma_project_month_source
  ON public.project_month_allocations(project_id, month_date, source);

NOTIFY pgrst, 'reload schema';

COMMIT;
