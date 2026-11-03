-- ============================================================================
-- 128 — departments.counts_in_capacity (2026-11-04, capacity round 2 item 1)
-- ============================================================================
-- Andrew: "remove MGMT from capacity — it's non-billable and doesn't have
-- hours associated with it." At Built, MGMT holds four non-billable people AND
-- Trent Trask (billable, MGMT + Engineering + CNC). The even dept split gave a
-- third of Trent's day to MGMT, stealing it from Eng/CNC, and MGMT's capacity
-- with ~0 booked diluted every shop-wide %. Excluding non-billable PEOPLE
-- wouldn't fix that (Trent is billable), so it's a DEPARTMENT flag: a
-- non-counting dept gets no capacity, no %, no row on /capacity, and a member's
-- day splits only across their COUNTING depts (lib/shop-rate-setup).
--
-- Backfill (first run only): depts named exactly MGMT / Management start off.
-- Anything else (Sales, Project Management…) is toggled on /team's dept card.
-- Idempotent: re-running never flips a dept the shop has since changed.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'counts_in_capacity'
  ) THEN
    ALTER TABLE public.departments ADD COLUMN counts_in_capacity boolean NOT NULL DEFAULT true;
    UPDATE public.departments SET counts_in_capacity = false
      WHERE name ~* '^\s*(mgmt|management)\s*$';
  END IF;
END $$;

COMMENT ON COLUMN public.departments.counts_in_capacity IS
  'false = management / non-production: no capacity, excluded from /capacity + /schedule math; members'' hours split over counting depts only. See 128.';

COMMIT;

NOTIFY pgrst, 'reload schema';
