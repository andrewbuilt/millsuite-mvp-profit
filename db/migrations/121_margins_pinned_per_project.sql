-- ============================================================================
-- 121 — Margin change safety: every project pins its default margins (2026-10-23)
-- ============================================================================
-- Same medicine as 118 (the shop rate). Margins are three per-bucket columns
-- on PROJECTS (labor / material / consumable, 052); NULL means "inherit the
-- org's CURRENT default". Prod on 2026-10-23: 21 of 27 native open bids and
-- 22 native sold / in-production / complete jobs had NULL pins — so saving a
-- new default margin in Settings silently repriced them, signed contracts
-- included. Imported jobs price their added scope at the org default always
-- (the importer's 0% pins are skipped on purpose — lib/pricing).
--
--   projects.locked_margins  — {"labor":35,"material":35,"consumable":35}:
--                              the defaults this project inherits, stamped at
--                              INSERT from the org (trigger below) and
--                              backfilled at TODAY's org defaults — exactly
--                              what those projects resolve to now, so running
--                              this moves no number. Resolution becomes:
--                              explicit project pin → locked_margins → org →
--                              35 (lib/pricing.resolveBucketMargins). A copy
--                              carries the SOURCE's lock (spread-and-strip).
--   projects.margins_ignored — the org defaults the user chose to KEEP this
--                              project off of ("Keep" on the margin banner);
--                              the banner stays quiet until they move again.
--
-- Idempotent. No RLS change (columns on an org-policied table).
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS locked_margins jsonb NULL;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS margins_ignored jsonb NULL;

COMMENT ON COLUMN public.projects.locked_margins IS
  'Default margins this project inherits {labor,material,consumable}, stamped at insert from the org (121). Explicit *_margin_pct pins still win. Changes only via the margin banner.';
COMMENT ON COLUMN public.projects.margins_ignored IS
  'The org default margins the user chose to keep this project off of (121).';

-- Backfill at today's org defaults (null org column → 35, the code's fallback).
UPDATE public.projects p
   SET locked_margins = jsonb_build_object(
         'labor',      COALESCE(o.labor_margin_pct, 35),
         'material',   COALESCE(o.material_margin_pct, 35),
         'consumable', COALESCE(o.consumable_margin_pct, 35))
  FROM public.orgs o
 WHERE p.org_id = o.id
   AND p.locked_margins IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_project_margins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.locked_margins IS NULL AND NEW.org_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'labor',      COALESCE(o.labor_margin_pct, 35),
             'material',   COALESCE(o.material_margin_pct, 35),
             'consumable', COALESCE(o.consumable_margin_pct, 35))
      INTO NEW.locked_margins
      FROM public.orgs o
     WHERE o.id = NEW.org_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_project_margins() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS projects_stamp_margins ON public.projects;
CREATE TRIGGER projects_stamp_margins
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_margins();

COMMIT;

NOTIFY pgrst, 'reload schema';
