-- ============================================================================
-- 074 — Flatten door materials into the catalog; finishes → door type
-- ============================================================================
-- Door materials become plain catalog materials (materials.show_in_door), the
-- same way carcass + back-panel already work. The composer's door-material
-- dropdown reads the catalog (chunk B/C follow-up), so the "Door" flag finally
-- means something and there's one walnut at one price.
--
-- Door FINISHES were nested under a (door type + material) row
-- (door_type_material_finishes.door_type_material_id). Finish labor/material
-- per door is really a property of the DOOR TYPE (a slab finishes differently
-- than a raised panel), not the specific wood — so we re-anchor finishes to
-- the door type. This migration adds door_type_id + backfills it from the old
-- join, and drops the NOT NULL on the now-legacy door_type_material_id.
--
-- door_type_materials is left in place (vestigial) for rollback; nothing reads
-- it after the code swap. Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.door_type_material_finishes
  ADD COLUMN IF NOT EXISTS door_type_id uuid NULL REFERENCES public.door_types(id) ON DELETE CASCADE;

-- Backfill door_type_id from the old join row.
UPDATE public.door_type_material_finishes f
   SET door_type_id = dtm.door_type_id
  FROM public.door_type_materials dtm
 WHERE f.door_type_material_id = dtm.id
   AND f.door_type_id IS NULL;

-- The finish no longer requires a material parent.
ALTER TABLE public.door_type_material_finishes
  ALTER COLUMN door_type_material_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_door_finishes_type
  ON public.door_type_material_finishes(door_type_id) WHERE active;

COMMIT;

NOTIFY pgrst, 'reload schema';
