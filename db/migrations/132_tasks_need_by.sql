-- ============================================================================
-- 132 — tasks.need_by: TASKS GET REAL TIME (2026-11-12)
-- ============================================================================
-- ⛔ DELIBERATELY REVERSES 093's "buckets never auto-roll" — Andrew's call:
-- "a next-week task is always next week, so it's never due." Every task gets a
-- need-by DATE (null = Someday); the groups (Overdue · Today · This week ·
-- Next week · Later · Someday) are COMPUTED from need_by vs today in
-- lib/tasks.ts, so a task stamped next Friday walks into This week, Today,
-- then Overdue on its own. Overdue = need_by < today (the 112
-- bucket_changed_at clock is retired — one truth).
--
-- BACKFILL (first run only — guarded on the column being new):
--   today     → today
--   this_week → this Friday while it's ahead; Fri/Sat → this Sunday (still
--               reads This week); on Sunday → today
--   next_week → next Friday
--   someday   → NULL
-- Stale Today tasks land Overdue on their next past-day — correct; they
-- already wore past-due chips.
--
-- `bucket` STAYS (NOT NULL + CHECK from 093): the code still writes a derived
-- value so old reads keep working during deploy; nothing reads it. Retire it
-- in a later migration once this has settled.
--
-- Idempotent. Run on prod BEFORE deploying the code (the task list selects
-- need_by).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  mon date := date_trunc('week', current_date)::date;  -- ISO week: Monday
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'need_by'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN need_by date NULL;
    UPDATE public.tasks SET need_by = CASE bucket
      WHEN 'today'     THEN current_date
      WHEN 'this_week' THEN CASE WHEN mon + 4 > current_date THEN mon + 4 WHEN mon + 6 > current_date THEN mon + 6 ELSE current_date END
      WHEN 'next_week' THEN mon + 11
      ELSE NULL
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_org_need_by ON public.tasks(org_id, need_by);

COMMENT ON COLUMN public.tasks.need_by IS
  'Need-by date (null = Someday). Groups are computed from it vs today — see lib/tasks.ts + 132. Replaces the stored bucket.';

COMMIT;

NOTIFY pgrst, 'reload schema';
