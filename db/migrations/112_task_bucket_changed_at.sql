-- ============================================================================
-- 112 — tasks.bucket_changed_at  (the "Past due" tag on stale Today tasks)
-- ============================================================================
-- When did this task last change bucket? Buckets have no dates (093: a curated
-- list, not a calendar — nothing auto-rolls), so "past due" can only mean
-- "sitting in Today since a previous day." This stamp is what makes that
-- computable: a not-done Today task whose stamp is before today gets a red
-- "Past due · Nd" chip in the panel, /tasks and /pm's Today card.
--
-- ⛔ THE STAMP IS REWRITTEN BY THE APP, NOT A TRIGGER. Every bucket write goes
-- through lib/tasks.updateTask (drag on both surfaces, the row editor's bucket
-- buttons — verified 2026-09-18: no other code path writes tasks.bucket), and
-- that one function stamps it whenever the patch carries a bucket. A trigger
-- would also fire on the backfill below and on hand-run SQL, which is exactly
-- when you DON'T want the clock reset.
--
-- DEFAULT now() covers createTask — a new task "entered" its bucket at birth.
--
-- Backfill from updated_at, not created_at: it's the closest recorded moment
-- to "when did someone last touch this row", so existing stale Today tasks
-- show a plausible age instead of all reading as freshly moved (now()) or
-- absurdly old (created_at on a task that's been bounced between buckets).
-- Approximate once, exact forever after.
--
-- Nullable on purpose: a null (pre-backfill, or a row inserted by hand) means
-- "unknown", and the UI shows NO chip rather than a guessed one.
--
-- Idempotent. No RLS change — `tasks` already carries its FOR ALL org policy.
-- ============================================================================

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS bucket_changed_at timestamptz DEFAULT now();

-- Only rows the column didn't exist for yet — re-running never resets a stamp.
UPDATE public.tasks
  SET bucket_changed_at = updated_at
  WHERE bucket_changed_at IS NULL;

COMMENT ON COLUMN public.tasks.bucket_changed_at IS
  'When the task last changed bucket. Written by lib/tasks.updateTask on every '
  'bucket change; default now() covers inserts. Drives the "Past due · Nd" chip '
  'on stale Today tasks. Null = unknown (no chip). See migration 112.';

COMMIT;

NOTIFY pgrst, 'reload schema';
