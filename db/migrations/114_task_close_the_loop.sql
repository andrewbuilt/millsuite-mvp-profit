-- ============================================================================
-- 114 — tasks.completed_by + tasks.acknowledged_at  (close-the-loop alerts)
-- ============================================================================
-- Andrew, 2026-09-23: when an ASSIGNEE finishes a task, the CREATOR gets the
-- final say — a "Completed for you" strip (on /pm and the task panel) listing
-- tasks you created that someone else finished, each with a Close out button.
--
-- Two columns make that computable:
--
--   completed_by    — WHO flipped it done (LOGIN id, users.id — same id space
--                     as created_by, see the two-name-spaces rule in
--                     lib/tasks). Stamped by setTaskDone from the session;
--                     cleared when a task is restored out of the Archive.
--   acknowledged_at — the creator's "seen it". Null + completed by someone
--                     else = sits in the strip. Stamped by Close out.
--
-- The strip's membership rule (in code, not SQL): done_at NOT NULL AND
-- acknowledged_at NULL AND completed_by NOT NULL AND completed_by <> created_by.
-- Self-completed tasks never alert — you don't need to be told what you did.
--
-- ⛔ NO BACKFILL for completed_by, ON PURPOSE. History doesn't record who
-- completed old tasks, and guessing (e.g. first assignee) would flood the
-- strip with months of stale "completed for you" rows on day one — an alert
-- feature that opens by crying wolf is dead on arrival. Old completed tasks
-- simply never enter the strip; the loop starts with the next completion.
--
-- In-app only — no email/push (none is connected).
--
-- Idempotent. No RLS change — `tasks` already carries its FOR ALL org policy.
-- ============================================================================

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS completed_by uuid;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

COMMENT ON COLUMN public.tasks.completed_by IS
  'LOGIN id (users.id) of whoever flipped done_at on. Stamped by the app, '
  'cleared on restore. Drives the creator''s "Completed for you" strip. '
  'Null on tasks completed before migration 114 — those never alert. See 114.';

COMMENT ON COLUMN public.tasks.acknowledged_at IS
  'When the CREATOR closed out a task someone else completed. Null + foreign '
  'completed_by = still in the "Completed for you" strip. See migration 114.';

COMMIT;

NOTIFY pgrst, 'reload schema';
