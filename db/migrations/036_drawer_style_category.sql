-- ============================================================================
-- 036 — Drawer-style category + per-drawer labor columns
-- ============================================================================
-- Mirrors the door-style shape (migration 019). A drawer style is a
-- rate_book_items row under a category whose item_type='drawer_style';
-- per-drawer hours by department live in dedicated columns so the schema
-- is symmetric with door_labor_hours_*.
--
-- Composer math: drawerLabor = drawerCount × Σ(drawer_labor_hours_dept) ×
-- shop_rate. Calibration unit matches the door walkthrough — 4 drawers at
-- a typical Base size — so answers divide by 4 on save and storage is per-
-- drawer.
--
-- No data migration. Orgs start with an empty drawer-styles list; the
-- composer's drawer-style dropdown shows "+ Add new drawer style" and
-- the walkthrough creates the category on first save.
-- ============================================================================

BEGIN;

-- 1. Allow 'drawer_style' as a category item_type ---------------------------

ALTER TABLE public.rate_book_categories
  DROP CONSTRAINT IF EXISTS rate_book_categories_item_type_check;

ALTER TABLE public.rate_book_categories
  ADD CONSTRAINT rate_book_categories_item_type_check
    CHECK (item_type IN (
      'door_style',
      'drawer_style',
      'cabinet_style',
      'install_style',
      'hardware',
      'finish',
      'back_panel_material',
      'custom'
    ));

-- 2. Per-drawer labor columns on rate_book_items ----------------------------

ALTER TABLE public.rate_book_items
  ADD COLUMN IF NOT EXISTS drawer_labor_hours_eng      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drawer_labor_hours_cnc      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drawer_labor_hours_assembly numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drawer_labor_hours_finish   numeric NOT NULL DEFAULT 0;

COMMIT;
