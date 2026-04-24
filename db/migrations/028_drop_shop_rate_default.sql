-- Migration 028 - drop the legacy $75 shop_rate default.
-- Per Phase 12 dogfood-3 Issue 13a.
--
-- docs/migration.sql declared orgs.shop_rate DECIMAL DEFAULT 75. Every
-- new org boots with $75/hr, then the walkthrough asks the user to
-- "override the current $75 rate" - confusing, since the user never
-- set $75. App-side fallbacks (|| 75 / ?? 75) compounded the problem
-- by silently producing $75-backed pricing for any uncalibrated org.
--
-- This migration drops the column default and resets the legacy $75
-- value on orgs that haven't run the walkthrough yet (no
-- overhead_inputs / team_members / billable_hours_inputs). Orgs that
-- intentionally set $75 keep it because they have walkthrough data.
--
-- App fallbacks landed in the same PR: every || 75 and ?? 75 swapped
-- to ?? 0 so an uncalibrated org reads as $0/hr instead of phantom $75.
--
-- Idempotent.

BEGIN;

ALTER TABLE public.orgs
  ALTER COLUMN shop_rate DROP DEFAULT;

UPDATE public.orgs
   SET shop_rate = NULL
 WHERE shop_rate = 75
   AND overhead_inputs IS NULL
   AND team_members    IS NULL
   AND billable_hours_inputs IS NULL;

COMMIT;

-- DOWN migration reference:
--   BEGIN;
--   ALTER TABLE public.orgs ALTER COLUMN shop_rate SET DEFAULT 75;
--   COMMIT;
