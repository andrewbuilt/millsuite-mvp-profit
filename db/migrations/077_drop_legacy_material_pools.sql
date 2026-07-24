-- ============================================================================
-- 077 — Drop the legacy carcass + ext material pool tables (chunk B/E cleanup)
-- ============================================================================
-- After the materials-catalog rebuild (072) + door-flatten (074), carcass and
-- back-panel materials are catalog rows (materials.show_in_*), and the composer
-- no longer reads these pools. The lib CRUD for them is deleted. These two
-- standalone tables are now fully unreferenced:
--   rate_book_carcass_materials  (carcass pool — replaced by the catalog)
--   rate_book_ext_materials      (legacy face-stock pool — dead since 038)
--
-- NOT dropped (still referenced): door_type_materials (solid-wood recalc +
-- listDoorTypeMaterialsForSolidWood), and the back_panel_material rows live in
-- the shared rate_book_items table (kept, they back the catalog via material_id).
--
-- Idempotent (DROP TABLE IF EXISTS). No data to preserve (per Andrew).
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.rate_book_carcass_materials;
DROP TABLE IF EXISTS public.rate_book_ext_materials;

COMMIT;

NOTIFY pgrst, 'reload schema';
