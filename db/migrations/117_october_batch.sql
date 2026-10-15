-- ============================================================================
-- 117 — October batch: auto-task rules · time-entry edit stamps · temp projects
-- ============================================================================
-- One file for the whole batch (scoped 2026-10-15):
--
--   orgs.auto_task_rules   — jsonb, the tiny auto-task mechanism (items 1+2).
--                            Shape: { "preprod_coordinator": "<roster id>",
--                                     "pto_coordinator":     "<roster id>" }
--                            ROSTER ids (orgs.team_members[].id), the same id
--                            space tasks.assignee_ids holds. Null/missing key
--                            = rule off, no task. Read by lib/auto-tasks.
--   time_entries.edited_by — LOGIN id (users.id) of the last manual edit on
--   time_entries.edited_at   /time (item 3). Cheap honesty, not an audit
--                            trail: null = never hand-edited.
--   projects.temp_at       — non-null marks an hours-only TEMP project (item
--                            9). Like practice_at, but separate: practice is
--                            the tour's and gets cleaned up; temp jobs are
--                            real tracking and must not be.
--
-- Idempotent. No RLS change — all three tables already carry org policies
-- (orgs 083, time_entries 100, projects 083).
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS auto_task_rules jsonb;

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS edited_by uuid NULL;

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS edited_at timestamptz NULL;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS temp_at timestamptz NULL;

COMMENT ON COLUMN public.orgs.auto_task_rules IS
  'Auto-task coordinators by rule key (roster ids). See lib/auto-tasks + 117.';
COMMENT ON COLUMN public.time_entries.edited_by IS
  'Login id (users.id) of the last manual edit on /time. Null = never edited. See 117.';
COMMENT ON COLUMN public.projects.temp_at IS
  'Hours-only temp project (tracking habit). Excluded from sales/payments/'
  'reports/capacity/schedule. NOT practice — never auto-cleaned. See 117.';

COMMIT;

NOTIFY pgrst, 'reload schema';
