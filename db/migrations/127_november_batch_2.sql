-- ============================================================================
-- 127 — November batch 2 (2026-11-03)
-- ============================================================================
-- Item 5: a second review task, ON THE DAY (Andrew's reminder defaults: the
--   author gets a Today task 7 days before AND the day of). The lead task's
--   once-only stamp is task_fired_at (125); this is the day-of one.
--
-- Idempotent. Run on prod BEFORE deploying the code that reads these columns.
-- ============================================================================

BEGIN;

-- ── Item 5: day-of review task stamp ────────────────────────────────────────
ALTER TABLE public.employee_reviews ADD COLUMN IF NOT EXISTS dayof_task_fired_at timestamptz;

COMMIT;

NOTIFY pgrst, 'reload schema';
