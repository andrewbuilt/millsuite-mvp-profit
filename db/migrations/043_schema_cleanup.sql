-- ============================================================================
-- 043 — Schema cleanup (narrowed)
-- ============================================================================
-- Drops legacy schema that has zero live readers, verified by grep
-- before this migration was written:
--
--   1. rate_book_items rows under category.item_type='door_style'
--      and the door_style category rows themselves. Door pricing moved
--      to the door_types / door_type_materials / door_type_material_finishes
--      trio in migration 038. lib/composer-loader.ts reads door_types
--      only; the legacy rows were preserved as active=false at the time
--      of the v2 cutover but nothing references them.
--
--   2. users.hourly_cost + users.is_billable columns. Team rate +
--      billable-toggle moved to orgs.team_members (jsonb) when the
--      Settings page was rebuilt. Only a documenting comment in
--      app/(app)/team/page.tsx remains, narrating the migration.
--
-- shop_rate_settings is NOT in this migration — four API routes
-- (auth/setup, stripe-webhook, shop-report, weekly-snapshot) still
-- read the legacy flat columns. Port them to orgs.overhead_inputs
-- jsonb first, then drop the table in a follow-up.
-- ============================================================================

BEGIN;

-- 1. Drop legacy door_style rate-book content -----------------------------

DELETE FROM public.rate_book_items
 WHERE category_id IN (
   SELECT id FROM public.rate_book_categories WHERE item_type = 'door_style'
 );

DELETE FROM public.rate_book_categories
 WHERE item_type = 'door_style';

-- 2. Drop dead user-level rate columns ------------------------------------

ALTER TABLE public.users
  DROP COLUMN IF EXISTS hourly_cost,
  DROP COLUMN IF EXISTS is_billable;

COMMIT;
