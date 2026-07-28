-- ============================================================================
-- 078 — Cabinet features: generalize the LED mechanism (rate-book chunk F)
-- ============================================================================
-- LED was LED-specific (led_types + ComposerSlots.led). Generalize to
-- calibrated CABINET FEATURES attachable to base/upper/full lines, with two
-- modes:
--   'runs'   — multiple rows on a line (type + LF each). LED works this way.
--   'toggle' — a per-line on/off; applies at the line's LF automatically.
--              Face frame works this way.
-- Every feature is calibrated PER LINEAR FOOT: labor hours/LF by dept + a
-- material contribution/LF. Material can be a blended flat $/LF (LED strip +
-- channel + driver) and/or catalog stock consumed per LF (face frame eats
-- sheet/bf stock — real stock, not a % markup).
--
-- LED types migrate in as mode='runs'. led_types stays for now (the composer
-- reads it until chunk F's composer swap ships); a later migration drops it.
--
-- Idempotent. Run on prod before the code that reads cabinet_features.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cabinet_features (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                       uuid        NOT NULL,
  name                         text        NOT NULL,
  mode                         text        NOT NULL DEFAULT 'runs'
    CHECK (mode IN ('runs','toggle')),
  -- Labor hours per LINEAR FOOT, by dept (matches the composer's line-labor
  -- model; install is billed separately).
  labor_hours_eng_per_lf       numeric     NOT NULL DEFAULT 0,
  labor_hours_cnc_per_lf       numeric     NOT NULL DEFAULT 0,
  labor_hours_assembly_per_lf  numeric     NOT NULL DEFAULT 0,
  labor_hours_finish_per_lf    numeric     NOT NULL DEFAULT 0,
  -- Blended flat material $/LF (LED strip/channel/driver amortized). 0 when
  -- the feature's stock comes from the catalog instead.
  material_cost_per_lf         numeric     NOT NULL DEFAULT 0,
  -- Catalog stock consumed per LF (face frame). NULL = no catalog material.
  material_id                  uuid        NULL
    REFERENCES public.materials(id) ON DELETE SET NULL,
  material_consumption_per_lf  numeric     NOT NULL DEFAULT 0,
  calibrated                   boolean     NOT NULL DEFAULT false,
  confidence                   text        NOT NULL DEFAULT 'untested',
  active                       boolean     NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cabinet_features_org
  ON public.cabinet_features(org_id)
  WHERE active;

-- RLS (org-scoped, mirrors led_types) ---------------------------------------

ALTER TABLE public.cabinet_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cabinet_features_select ON public.cabinet_features;
DROP POLICY IF EXISTS cabinet_features_insert ON public.cabinet_features;
DROP POLICY IF EXISTS cabinet_features_update ON public.cabinet_features;
DROP POLICY IF EXISTS cabinet_features_delete ON public.cabinet_features;

CREATE POLICY cabinet_features_select ON public.cabinet_features FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = cabinet_features.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY cabinet_features_insert ON public.cabinet_features FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = cabinet_features.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY cabinet_features_update ON public.cabinet_features FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = cabinet_features.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = cabinet_features.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY cabinet_features_delete ON public.cabinet_features FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = cabinet_features.org_id AND u.auth_user_id = auth.uid()));

-- Migrate LED types → cabinet_features (mode 'runs'). Idempotent: skip any
-- (org, name) already present.
INSERT INTO public.cabinet_features
  (org_id, name, mode, labor_hours_eng_per_lf, labor_hours_cnc_per_lf,
   labor_hours_assembly_per_lf, labor_hours_finish_per_lf, material_cost_per_lf,
   calibrated, confidence, active)
SELECT lt.org_id, lt.name, 'runs', lt.labor_hours_eng_per_lf, lt.labor_hours_cnc_per_lf,
       lt.labor_hours_assembly_per_lf, lt.labor_hours_finish_per_lf, lt.material_cost_per_lf,
       lt.calibrated, lt.confidence, lt.active
FROM public.led_types lt
WHERE lt.active
  AND NOT EXISTS (
    SELECT 1 FROM public.cabinet_features cf
     WHERE cf.org_id = lt.org_id AND cf.name = lt.name
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
