-- ============================================================================
-- 035 — Back panel material category
-- ============================================================================
-- Adds 'back_panel_material' to rate_book_categories.item_type so back-panel
-- material entries can live alongside cabinets / doors / finishes in the
-- rate book. Storage shape: rate_book_items rows (name + sheet_cost) under
-- a category whose item_type='back_panel_material'. The composer reads
-- these as a dedicated list — separate from rate_book_ext_materials so
-- face stock (Walnut, White oak, etc.) doesn't leak into the back-panel
-- dropdown.
--
-- No data migration. Orgs start with an empty back-panel list; the
-- composer's "+ Add new material" flow creates the category on first add.
-- ============================================================================

BEGIN;

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

COMMIT;
