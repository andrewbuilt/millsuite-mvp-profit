-- ============================================================================
-- 073 — LED as a calibrated feature (rate-book overhaul, chunk D)
-- ============================================================================
-- LED stops being a stub "product" and becomes a calibrated FEATURE that
-- rides on cabinet-run composer lines (and, later, custom products). Each
-- `led_types` row is a kind of LED (under-cabinet, interior, toe-kick …)
-- calibrated PER LINEAR FOOT: labor hours/LF by dept + material $/LF. A
-- composer line can carry several LED rows (type + LF each); the hours flow
-- into the line's dept hours and the material into its material cost.
--
-- Mirrors door_types' shape (per-unit labor by dept + a calibrated flag) but
-- keyed on LF instead of per-door. Confidence column included so LED types
-- list in the rate book "like everything else".
--
-- Idempotent. Run on prod before the code that reads `led_types` ships.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.led_types (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                       uuid        NOT NULL,
  name                         text        NOT NULL,
  -- Labor hours consumed PER LINEAR FOOT, by dept (matches the composer's
  -- eng/cnc/assembly/finish line-labor model; install is billed separately).
  labor_hours_eng_per_lf       numeric     NOT NULL DEFAULT 0,
  labor_hours_cnc_per_lf       numeric     NOT NULL DEFAULT 0,
  labor_hours_assembly_per_lf  numeric     NOT NULL DEFAULT 0,
  labor_hours_finish_per_lf    numeric     NOT NULL DEFAULT 0,
  -- Material cost per linear foot (the strip, channel, connectors, driver
  -- amortized per LF — one blended number, like a door material's cost).
  material_cost_per_lf         numeric     NOT NULL DEFAULT 0,
  -- True once any labor/LF is set (same convention as door_types.calibrated).
  calibrated                   boolean     NOT NULL DEFAULT false,
  confidence                   text        NOT NULL DEFAULT 'untested',
  active                       boolean     NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_led_types_org
  ON public.led_types(org_id)
  WHERE active;

-- RLS (org-scoped, mirrors door_types / 038) ---------------------------------

ALTER TABLE public.led_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS led_types_select ON public.led_types;
DROP POLICY IF EXISTS led_types_insert ON public.led_types;
DROP POLICY IF EXISTS led_types_update ON public.led_types;
DROP POLICY IF EXISTS led_types_delete ON public.led_types;

CREATE POLICY led_types_select ON public.led_types FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = led_types.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY led_types_insert ON public.led_types FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = led_types.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY led_types_update ON public.led_types FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = led_types.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = led_types.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY led_types_delete ON public.led_types FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = led_types.org_id AND u.auth_user_id = auth.uid()));

COMMIT;

NOTIFY pgrst, 'reload schema';
