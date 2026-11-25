-- ============================================================================
-- 137 — eng_pool_order (2026-11-25, engineering board redesign)
-- ============================================================================
-- The redesigned /engineering lets the shop rank the "Needs an engineer"
-- list (projects with engineering left and no engineer yet) by dragging.
-- That order is shared by everyone, so it lives here, one row per project:
--
--   priority   numeric — lower = higher on the list. Rows for projects that
--              have since been assigned are simply ignored by the board.
--
-- Until this runs the board still works: it keeps the order in that browser
-- only and says so. Additive; safe to run before the code that reads it.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.eng_pool_order (
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  priority    numeric NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, project_id)
);

ALTER TABLE public.eng_pool_order ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eng_pool_order_own_org ON public.eng_pool_order;
CREATE POLICY eng_pool_order_own_org ON public.eng_pool_order
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
