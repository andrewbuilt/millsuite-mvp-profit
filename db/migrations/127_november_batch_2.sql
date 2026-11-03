-- ============================================================================
-- 127 — November batch 2 (2026-11-03)
-- ============================================================================
-- Item 5: a second review task, ON THE DAY (Andrew's reminder defaults: the
--   author gets a Today task 7 days before AND the day of). The lead task's
--   once-only stamp is task_fired_at (125); this is the day-of one.
-- Item 7: workers edit their OWN time entries on /me, flagged. Every self-edit
--   stamps edited_by/edited_at (117) AND needs_review = true, and keeps what
--   the entry said BEFORE the first unreviewed edit in edit_before (hours,
--   project, sub, dept) so the manager's "Edited by crew" strip on /time can
--   show was → now. Acknowledging clears both. No RLS change: time_entries is
--   already org-scoped FOR ALL (100).
--
-- Idempotent. Run on prod BEFORE deploying the code that reads these columns.
-- ============================================================================

BEGIN;

-- ── Item 5: day-of review task stamp ────────────────────────────────────────
ALTER TABLE public.employee_reviews ADD COLUMN IF NOT EXISTS dayof_task_fired_at timestamptz;

-- ── Item 7: crew self-edits, flagged for a manager ──────────────────────────
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS edit_before jsonb;
CREATE INDEX IF NOT EXISTS idx_time_entries_needs_review
  ON public.time_entries(org_id) WHERE needs_review;
COMMENT ON COLUMN public.time_entries.needs_review IS
  'A worker edited their own entry on /me; a manager has not acknowledged it on /time yet. See 127.';
COMMENT ON COLUMN public.time_entries.edit_before IS
  'What the entry said before the first unreviewed self-edit: {duration_minutes, project_id, subproject_id, department_id}. See 127.';

COMMIT;

NOTIFY pgrst, 'reload schema';
