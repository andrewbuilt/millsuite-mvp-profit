-- ============================================================================
-- 138 — eng_due_checks (2026-11-25, the end-of-day engineering check)
-- ============================================================================
-- At 3:30 PM shop time an engineer with a job due today (or overdue) that
-- isn't marked "Engineering done" is asked, and can't dismiss it:
--   · Done      → the job is marked Engineering done.
--   · Not yet   → they give a new date + why. The due date (eng_assignments.
--                 firm_date) moves, the job goes to the top of their list,
--                 and the PM (Kaylin) gets a task.
--   · No answer → the next time anyone opens MillSuite after that day, the
--                 PM gets a Critical task. The engineer keeps being asked.
-- One row per answer, so slips are countable per job and per engineer.
--
--   check_date  the shop day the answer is for (a 'missed' row = the due day)
--   due_date    the due date being asked about
--   answer      'done' | 'not_yet' | 'missed'
--   new_date    'not_yet' only: when they say it'll be ready
--   reason      'not_yet' only: why it isn't done
--   task_id     the PM task this created, if any
--
-- Written only by /api/engineering/due-check (service role); the shop can
-- read its own rows. Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.eng_due_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  member_id    text NOT NULL,
  check_date   date NOT NULL,
  due_date     date,
  answer       text NOT NULL CHECK (answer IN ('done', 'not_yet', 'missed')),
  new_date     date,
  reason       text,
  answered_by  uuid,
  task_id      uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS eng_due_checks_project_day
  ON public.eng_due_checks(project_id, check_date);
CREATE INDEX IF NOT EXISTS eng_due_checks_org
  ON public.eng_due_checks(org_id, check_date DESC);

ALTER TABLE public.eng_due_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eng_due_checks_read_own_org ON public.eng_due_checks;
CREATE POLICY eng_due_checks_read_own_org ON public.eng_due_checks
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
