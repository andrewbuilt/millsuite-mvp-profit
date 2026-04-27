-- ============================================================================
-- 040 — Door material → solid wood link
-- ============================================================================
-- Lets a door_type_materials row be derived from a solid_wood_components
-- row instead of an entered sheet-stock $. The composer's add-material
-- modal gets a "Calculate from solid wood" tab — pick a wood + BDFT/door
-- and the modal computes cost_value for the operator. Both columns
-- nullable; sheet-stock materials leave them null.
--
-- ON DELETE SET NULL on solid_wood_component_id so deleting a wood row
-- doesn't cascade-delete door materials — the saved cost_value sticks
-- and the link just goes cold.
-- ============================================================================

BEGIN;

ALTER TABLE public.door_type_materials
  ADD COLUMN IF NOT EXISTS solid_wood_component_id uuid NULL
    REFERENCES public.solid_wood_components(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bdft_per_unit numeric NULL;

COMMIT;
