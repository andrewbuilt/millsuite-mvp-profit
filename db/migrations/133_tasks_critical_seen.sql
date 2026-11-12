-- ============================================================================
-- 133 — tasks: Critical flag + per-person "seen" (2026-11-12, Andrew)
-- ============================================================================
-- · critical  — a "drop everything" task. Picked from the Needed-by row
--   (Critical stamps need_by = today). Lights a RED badge on the nav task
--   icon for every assignee while it's open, and sorts to the top of every
--   list.
-- · seen_by   — ROSTER ids (orgs.team_members[].id, same id space as
--   assignee_ids) of assignees who have OPENED the task's detail. The blue
--   nav badge = my open tasks whose seen_by lacks me. Newly assigning someone
--   leaves them out of seen_by, so a reassignment re-alerts on its own.
--
-- Backfill: every existing task counts as seen by its current assignees —
-- otherwise every badge in the shop lights up with old work on deploy.
-- Idempotent.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'critical'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN critical boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'seen_by'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN seen_by jsonb NOT NULL DEFAULT '[]'::jsonb;
    -- One-time, only on the run that creates the column.
    UPDATE public.tasks SET seen_by = COALESCE(assignee_ids, '[]'::jsonb);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_org_critical_open
  ON public.tasks (org_id) WHERE critical AND done_at IS NULL;

NOTIFY pgrst, 'reload schema';
