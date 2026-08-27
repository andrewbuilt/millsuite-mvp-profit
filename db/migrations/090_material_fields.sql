-- ============================================================================
-- 090 — materials.category + materials.thickness (small-fixes wave, item 2)
-- ============================================================================
-- The catalog was one flat list with everything crammed into the name text
-- ("3/4 Maple Ply"), so finding a material meant reading every row. These two
-- nullable fields let the catalog GROUP by category and FILTER by thickness.
--
-- Both are free-text on purpose — no fixed vocabulary, no lookup table. Every
-- shop names its stock differently, and the UI seeds a datalist from whatever
-- values already exist in the org, so the list converges without a schema
-- decision. Nullable: existing rows stay valid and render under
-- "Uncategorized" until Andrew tags them.
--
-- Nothing prices off these columns — display/organization only. 089 stays
-- reserved for the annual_comp blob cleanup.
--
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS category text NULL;

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS thickness text NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
