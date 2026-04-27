-- ============================================================================
-- 039 — Solid wood components
-- ============================================================================
-- Per-org list of hardwood / solid-wood stock items. Lives in its own table
-- (not under rate_book_categories) because the cost shape is different from
-- sheet stock — board feet + a waste % multiplier instead of $/sheet × yield.
-- The rate-book sidebar surfaces it as a dedicated category alongside back-
-- panel materials and cabinets.
--
-- A future PR (chunk-e-solid-wood-2) wires these rows into the door-material
-- slot so operators can pick "8/4 Walnut" as a door material with cost
-- computed from BDFT × cost × (1 + waste%). This PR is standalone schema +
-- walkthrough + rate-book entry.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.solid_wood_components (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  name                  text NOT NULL,
  species               text NOT NULL,
  thickness_quarters    int  NOT NULL CHECK (thickness_quarters > 0),
  cost_per_bdft         numeric NOT NULL DEFAULT 0,
  waste_pct             numeric NOT NULL DEFAULT 15
                          CHECK (waste_pct >= 0 AND waste_pct < 100),
  notes                 text,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_solid_wood_org
  ON public.solid_wood_components(org_id) WHERE active;

ALTER TABLE public.solid_wood_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solid_wood_select ON public.solid_wood_components;
DROP POLICY IF EXISTS solid_wood_insert ON public.solid_wood_components;
DROP POLICY IF EXISTS solid_wood_update ON public.solid_wood_components;
DROP POLICY IF EXISTS solid_wood_delete ON public.solid_wood_components;

CREATE POLICY solid_wood_select ON public.solid_wood_components FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = solid_wood_components.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY solid_wood_insert ON public.solid_wood_components FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = solid_wood_components.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY solid_wood_update ON public.solid_wood_components FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = solid_wood_components.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = solid_wood_components.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY solid_wood_delete ON public.solid_wood_components FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = solid_wood_components.org_id AND u.auth_user_id = auth.uid()));

COMMIT;
