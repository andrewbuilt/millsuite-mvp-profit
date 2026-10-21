-- ============================================================================
-- 118 — Shop-rate change safety: every project pins its rate from creation
-- ============================================================================
-- Andrew (2026-10-21): change the shop rate whenever; it must not touch
-- anything being priced or already priced; a sent price never changes
-- silently; a gateway accepts or ignores the new rate.
--
-- Before this, `projects.locked_shop_rate` was stamped only on the FIRST move
-- into sold (lib/sales). Every open bid — sent ones included — priced labor at
-- the CURRENT `orgs.shop_rate`, so one save on Settings repriced them all on
-- the project page, and the next line edit wrote the new number into
-- bid_total. lib/composer-staleness even documented it ("a shop-rate edit
-- alone is NOT stale — every displayed labor cost already reflects the new
-- rate").
--
--   projects.locked_shop_rate  — now stamped at INSERT (trigger below) from
--                                the org's rate, on every creation path,
--                                present and future. Backfilled for every
--                                project that has none, to the CURRENT org
--                                rate — exactly what those projects price at
--                                today, so running this changes no number.
--                                The sold-stamp in lib/sales becomes a no-op
--                                (it only fills a null): a job sells at the
--                                rate it was bid at.
--   projects.shop_rate_ignored — the org rate the user chose to IGNORE on this
--                                project ("Keep $Y/hr"). The banner stays
--                                quiet until the org rate changes AGAIN.
--   estimate_lines.stale_ignored_sig
--                              — the composer-staleness gateway's ignore: the
--                                signature of the fresh values the user
--                                declined. The line stays quiet until the
--                                rate book moves it somewhere new.
--
-- Idempotent. No RLS change (columns on tables already under org policies).
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS shop_rate_ignored numeric NULL;

ALTER TABLE public.estimate_lines
  ADD COLUMN IF NOT EXISTS stale_ignored_sig text NULL;

COMMENT ON COLUMN public.projects.locked_shop_rate IS
  'Labor $/hr this project prices at. Stamped at insert from orgs.shop_rate (118); changes only via the explicit "Use new rate" action. See lib/shop-rate-gateway.';
COMMENT ON COLUMN public.projects.shop_rate_ignored IS
  'The org shop rate the user chose to keep this project off of. Banner re-offers only when the org rate differs from both. (118)';
COMMENT ON COLUMN public.estimate_lines.stale_ignored_sig IS
  'Signature of the fresh composer values the user chose to ignore for this line. (118)';

-- Backfill: pin every unpinned project to the rate it prices at TODAY.
UPDATE public.projects p
   SET locked_shop_rate = o.shop_rate
  FROM public.orgs o
 WHERE p.org_id = o.id
   AND (p.locked_shop_rate IS NULL OR p.locked_shop_rate = 0)
   AND o.shop_rate IS NOT NULL
   AND o.shop_rate > 0;

-- Stamp on insert. SECURITY DEFINER only to read the one org row; the
-- inserting user's own RLS still governs the projects insert itself.
CREATE OR REPLACE FUNCTION public.stamp_project_shop_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.locked_shop_rate IS NULL OR NEW.locked_shop_rate = 0) AND NEW.org_id IS NOT NULL THEN
    SELECT NULLIF(o.shop_rate, 0) INTO NEW.locked_shop_rate
      FROM public.orgs o
     WHERE o.id = NEW.org_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_project_shop_rate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS projects_stamp_shop_rate ON public.projects;
CREATE TRIGGER projects_stamp_shop_rate
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_shop_rate();

COMMIT;

NOTIFY pgrst, 'reload schema';
