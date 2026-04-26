-- ============================================================================
-- 037 — Drawer hardware cost + redundant safety on per-drawer hours
-- ============================================================================
-- Adds drawer_hardware_cost and re-asserts the drawer_labor_hours_* columns
-- in case migration 036 didn't reach this environment / its schema cache.
-- All ADD COLUMN IF NOT EXISTS — idempotent and safe to re-run.
--
-- Hardware is captured at the drawer-style level (slides + pulls + anything
-- that ships per-drawer). Composer math: drawerCount × drawer_hardware_cost.
-- ============================================================================

BEGIN;

ALTER TABLE public.rate_book_items
  ADD COLUMN IF NOT EXISTS drawer_labor_hours_eng      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drawer_labor_hours_cnc      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drawer_labor_hours_assembly numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drawer_labor_hours_finish   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drawer_hardware_cost        numeric NOT NULL DEFAULT 0;

COMMIT;
