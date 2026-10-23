-- ============================================================================
-- 120 — Solid Wood Top features (scoped 2026-10-23, Cowork design pass)
-- ============================================================================
-- Bowties, hand-rubbed finish, mitered / finger-jointed corners, cutouts —
-- the craft on a solid wood top that the BdFt-scaled calibration can't see.
-- SEPARATE from cabinet_features (078) on purpose: those are priced per LF of
-- cabinet; these have three different pricing shapes, and merging the two
-- mechanisms would make both worse.
--
--   pricing_mode
--     'each'          — hours by dept + material PER PIECE  (bowties, cutouts)
--     'sqft'          — hours by dept + material PER SQ FT  (hand-rubbed finish)
--     'length_steps'  — a step table of ABSOLUTE prices by length (corners):
--                       steps = [{ "up_to_ft": 1, "hours": {"eng":0,"cnc":0,
--                       "assembly":1.5,"finish":0.2}, "material": 0 }, …]
--                       The bracket is the first step whose up_to_ft ≥
--                       ceil(length). Labor is nonlinear (1'→2' is cheap,
--                       1'→4' isn't), so each step is its own price, not a
--                       rate. Past the last step: last step + extra_ft_* per
--                       extra foot — degrades gracefully, never blocks.
--   hours_* / material_per_unit — the per-unit price for 'each' / 'sqft'.
--   extra_ft_hours / extra_ft_material — 'length_steps' only.
--
-- Thickness variants are separate named features ("Miter · 8/4") — no schema
-- dimension for it in v1. Archive, don't delete (lines reference the id).
--
-- Idempotent. RLS mirrors cabinet_features. Run on prod before the code.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.swt_features (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL,
  name               text        NOT NULL,
  pricing_mode       text        NOT NULL DEFAULT 'each'
    CHECK (pricing_mode IN ('each','sqft','length_steps')),
  hours_eng          numeric     NOT NULL DEFAULT 0,
  hours_cnc          numeric     NOT NULL DEFAULT 0,
  hours_assembly     numeric     NOT NULL DEFAULT 0,
  hours_finish       numeric     NOT NULL DEFAULT 0,
  material_per_unit  numeric     NOT NULL DEFAULT 0,
  steps              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  extra_ft_hours     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  extra_ft_material  numeric     NOT NULL DEFAULT 0,
  active             boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swt_features_org
  ON public.swt_features(org_id)
  WHERE active;

ALTER TABLE public.swt_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS swt_features_select ON public.swt_features;
DROP POLICY IF EXISTS swt_features_insert ON public.swt_features;
DROP POLICY IF EXISTS swt_features_update ON public.swt_features;
DROP POLICY IF EXISTS swt_features_delete ON public.swt_features;

CREATE POLICY swt_features_select ON public.swt_features FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = swt_features.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY swt_features_insert ON public.swt_features FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = swt_features.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY swt_features_update ON public.swt_features FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = swt_features.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = swt_features.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY swt_features_delete ON public.swt_features FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = swt_features.org_id AND u.auth_user_id = auth.uid()));

COMMIT;

NOTIFY pgrst, 'reload schema';
