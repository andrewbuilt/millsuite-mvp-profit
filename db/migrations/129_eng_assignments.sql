-- ============================================================================
-- 129 — eng_assignments (2026-11-04, the ENGINEERING BOARD — batch-2 item D)
-- ============================================================================
-- /engineering plans the bottleneck: lanes = engineers, a strip = a project's
-- REMAINING engineering hours packed forward at the engineer's daily hours.
-- This table holds ONLY the plan — who, what order, any hand division, any
-- firm date. It is NOT a second source of hours:
--   · est eng hours  = the project's estimate rollup (lib/project-hours), the
--                      same figure /capacity reads
--   · tracked        = time_entries in the engineering dept (the time clock)
-- so /capacity and /schedule are untouched and the boards can't disagree.
--
--   member_id   orgs.team_members[].id (the roster id — the roster is jsonb,
--               so no FK)
--   dept        'eng' — the dept-switcher future; column only, no other-dept
--               UI in v1
--   priority    the rail order; numeric so a drag can land between two
--   divisions   [{date:'YYYY-MM-DD', hours:n}] from the divide modal;
--               NULL = auto-pack
--   firm_date   a hard drawings deadline; the board flags "at risk" when the
--               pack can't make it (it never slides silently)
--
-- One plan row per project per dept. Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.eng_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  member_id   text NOT NULL,
  dept        text NOT NULL DEFAULT 'eng',
  priority    numeric NOT NULL DEFAULT 0,
  divisions   jsonb,
  firm_date   date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.eng_assignments ADD COLUMN IF NOT EXISTS dept text NOT NULL DEFAULT 'eng';
ALTER TABLE public.eng_assignments ADD COLUMN IF NOT EXISTS divisions jsonb;
ALTER TABLE public.eng_assignments ADD COLUMN IF NOT EXISTS firm_date date;

CREATE UNIQUE INDEX IF NOT EXISTS eng_assignments_project_dept
  ON public.eng_assignments(project_id, dept);
CREATE INDEX IF NOT EXISTS eng_assignments_org
  ON public.eng_assignments(org_id);

ALTER TABLE public.eng_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eng_assignments_own_org ON public.eng_assignments;
CREATE POLICY eng_assignments_own_org ON public.eng_assignments
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
