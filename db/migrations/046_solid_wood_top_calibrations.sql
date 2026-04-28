-- ============================================================================
-- 046 — Solid Wood Top calibrations
-- ============================================================================
-- One row per org. Captures the labor calibration the operator runs once
-- through SolidWoodTopWalkthrough against a "typical top" of their choice.
-- Composer lines for the solid-wood-top product (formerly the locked
-- Countertop tile) scale these per-piece hours by BdFt:
--
--   bdft       = (L × W × T) / 144
--   calBdft    = (calib_length × calib_width × calib_thickness) / 144
--   scale      = bdft / calBdft
--   linehours  = sum_of_relevant_op_hours × scale × edgeMult
--
-- hours_by_op jsonb keys (set/cleared by walkthrough; missing = 0):
--   eng_drawing
--   cnc_cut_to_size
--   asy_wood_selection
--   asy_jointing
--   asy_planing
--   asy_ripping
--   asy_chopping
--   asy_glueup
--   asy_calib_sanding
--   asy_saw_cut_to_size       — used when default_cut_method = 'saw'
--   fin_sanding
--   fin_apply
--   ins_install_on_site
--
-- default_material_id is intentionally NOT a hard FK — the operator may
-- archive a solid_wood_components row without invalidating the
-- calibration's preferred default. The composer falls back to the first
-- active component if the saved id is missing/inactive.
--
-- Belt-and-suspenders: every column gets an ADD COLUMN IF NOT EXISTS in
-- addition to the CREATE TABLE so a half-baked prior run can't leave the
-- table missing a field. Past migrations have hit PGRST204 because of
-- exactly this — see PR #102 fix.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.solid_wood_top_calibrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  calib_length_in     numeric NOT NULL DEFAULT 96,
  calib_width_in      numeric NOT NULL DEFAULT 24,
  calib_thickness_in  numeric NOT NULL DEFAULT 1.5,
  hours_by_op         jsonb   NOT NULL DEFAULT '{}'::jsonb,
  edge_mult_hand      numeric NOT NULL DEFAULT 1.15,
  edge_mult_cnc       numeric NOT NULL DEFAULT 1.10,
  default_cut_method  text    NOT NULL DEFAULT 'saw' CHECK (default_cut_method IN ('saw','cnc')),
  default_material_id uuid    NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solid_wood_top_calibrations_org_id_key UNIQUE (org_id)
);

-- Defensive: re-add each column in case a prior partial migration left
-- the table skeletal. ADD COLUMN IF NOT EXISTS is a no-op when the
-- column already exists from the CREATE above.
ALTER TABLE public.solid_wood_top_calibrations
  ADD COLUMN IF NOT EXISTS calib_length_in     numeric NOT NULL DEFAULT 96;
ALTER TABLE public.solid_wood_top_calibrations
  ADD COLUMN IF NOT EXISTS calib_width_in      numeric NOT NULL DEFAULT 24;
ALTER TABLE public.solid_wood_top_calibrations
  ADD COLUMN IF NOT EXISTS calib_thickness_in  numeric NOT NULL DEFAULT 1.5;
ALTER TABLE public.solid_wood_top_calibrations
  ADD COLUMN IF NOT EXISTS hours_by_op         jsonb   NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.solid_wood_top_calibrations
  ADD COLUMN IF NOT EXISTS edge_mult_hand      numeric NOT NULL DEFAULT 1.15;
ALTER TABLE public.solid_wood_top_calibrations
  ADD COLUMN IF NOT EXISTS edge_mult_cnc       numeric NOT NULL DEFAULT 1.10;
ALTER TABLE public.solid_wood_top_calibrations
  ADD COLUMN IF NOT EXISTS default_cut_method  text    NOT NULL DEFAULT 'saw';
ALTER TABLE public.solid_wood_top_calibrations
  ADD COLUMN IF NOT EXISTS default_material_id uuid    NULL;
ALTER TABLE public.solid_wood_top_calibrations
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.solid_wood_top_calibrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS swt_calib_select ON public.solid_wood_top_calibrations;
DROP POLICY IF EXISTS swt_calib_write  ON public.solid_wood_top_calibrations;

CREATE POLICY swt_calib_select ON public.solid_wood_top_calibrations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = solid_wood_top_calibrations.org_id AND u.auth_user_id = auth.uid()
  ));

CREATE POLICY swt_calib_write ON public.solid_wood_top_calibrations FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = solid_wood_top_calibrations.org_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = solid_wood_top_calibrations.org_id AND u.auth_user_id = auth.uid()
  ));

NOTIFY pgrst, 'reload schema';

COMMIT;
