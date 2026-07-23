-- ============================================================================
-- 072 — Master materials catalog (rate-book overhaul, chunk B)
-- ============================================================================
-- ONE org-scoped `materials` catalog to replace the three separate material
-- pools:
--   1. rate_book_carcass_materials         (carcass box stock, $/sheet)
--   2. rate_book_items (back_panel_material category)  (back panel, $/sheet)
--   3. door_type_materials (038)            (door face, cost_value/cost_unit)
--
-- One PRICE per material (edit once → everything reprices). Per-use
-- visibility flags (show_in_carcass / _door / _back_panel / _shelf) keep the
-- composer slot dropdowns short ("quick grab") while a "browse all" escape
-- hatch reaches the whole catalog.
--
-- CONSUMPTION factors (sheets/LF, sheets/door) do NOT live here — they belong
-- to the calibrated product (lib/products.ts today, data in chunk E). The old
-- rate_book_carcass_materials.sheets_per_lf column was already dead (product
-- constants drive consumption); it stays behind on the old table, unused.
--
-- THIS MIGRATION IS ADDITIVE + NON-DESTRUCTIVE. It creates the catalog and
-- backfills it from the three pools, and stamps a `material_id` pointer on
-- every source row so the catalog row can be found from an existing row id.
-- The composer still reads the old tables until a later commit swaps the
-- reads pool-by-pool (with penny-parity checks). The old tables are retired
-- only after that. Saved estimate_lines.product_slots keep referencing the
-- old row ids — those ids stay valid because the old rows stay put.
--
-- Idempotent: re-running inserts catalog rows only for source rows that don't
-- yet carry a material_id (WHERE material_id IS NULL), so a second run is a
-- no-op. Run on prod BEFORE deploying any code that reads `materials`.
-- ============================================================================

BEGIN;

-- 1. materials catalog -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.materials (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL,
  name          text        NOT NULL,
  -- One price per material. cost_unit mirrors door_type_materials (038) so a
  -- door face priced per LF / BF / EA / lump folds in without loss; carcass +
  -- back panel are always 'sheet'.
  cost_value    numeric     NOT NULL DEFAULT 0,
  cost_unit     text        NOT NULL DEFAULT 'sheet'
    CHECK (cost_unit IN ('sheet','lf','bf','ea','lump')),
  notes         text,
  -- Per-use "quick grab" visibility flags. A material can show in several
  -- slots (e.g. the same ply is carcass + back panel). "Browse all" ignores
  -- these and lists the whole catalog.
  show_in_carcass    boolean NOT NULL DEFAULT false,
  show_in_door       boolean NOT NULL DEFAULT false,
  show_in_back_panel boolean NOT NULL DEFAULT false,
  show_in_shelf      boolean NOT NULL DEFAULT false,
  -- Solid-wood provenance carried over from door_type_materials (040): when a
  -- material's price is derived from a solid_wood_components row + board feet.
  solid_wood_component_id uuid NULL
    REFERENCES public.solid_wood_components(id) ON DELETE SET NULL,
  bdft_per_unit numeric     NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_org
  ON public.materials(org_id)
  WHERE active;

-- 2. RLS (org-scoped, mirrors door_type_materials / 038) --------------------

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS materials_select ON public.materials;
DROP POLICY IF EXISTS materials_insert ON public.materials;
DROP POLICY IF EXISTS materials_update ON public.materials;
DROP POLICY IF EXISTS materials_delete ON public.materials;

CREATE POLICY materials_select ON public.materials FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = materials.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY materials_insert ON public.materials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = materials.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY materials_update ON public.materials FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = materials.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = materials.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY materials_delete ON public.materials FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = materials.org_id AND u.auth_user_id = auth.uid()));

-- 3. material_id pointers on the three source tables ------------------------
-- Each old row points at its catalog row. Lets the composer resolve an
-- existing slot id (which references an OLD row) → its catalog price during
-- the transition, and lets us retire the old tables later without breaking
-- saved lines.

ALTER TABLE public.rate_book_carcass_materials
  ADD COLUMN IF NOT EXISTS material_id uuid NULL REFERENCES public.materials(id) ON DELETE SET NULL;
ALTER TABLE public.door_type_materials
  ADD COLUMN IF NOT EXISTS material_id uuid NULL REFERENCES public.materials(id) ON DELETE SET NULL;
ALTER TABLE public.rate_book_items
  ADD COLUMN IF NOT EXISTS material_id uuid NULL REFERENCES public.materials(id) ON DELETE SET NULL;

-- 4. Backfill the catalog from each pool ------------------------------------
-- One catalog row per source row that isn't linked yet (material_id IS NULL),
-- then wire the pointer. Sequential INSERT→UPDATE per row keeps the FK
-- (source.material_id → materials.id) satisfied at all times and makes the
-- idempotency obvious. Values map 1:1 → after the eventual read swap the
-- pricing math is byte-identical (same consumption, same cost). Beta scale:
-- a handful of materials per org.

DO $$
DECLARE
  r   record;
  mid uuid;
BEGIN
  -- 4a. Carcass → materials (cost_unit 'sheet', show_in_carcass)
  FOR r IN
    SELECT id, org_id, name, sheet_cost, active
      FROM public.rate_book_carcass_materials
     WHERE material_id IS NULL
  LOOP
    INSERT INTO public.materials
      (org_id, name, cost_value, cost_unit, show_in_carcass, active)
    VALUES (r.org_id, r.name, r.sheet_cost, 'sheet', true, r.active)
    RETURNING id INTO mid;
    UPDATE public.rate_book_carcass_materials SET material_id = mid WHERE id = r.id;
  END LOOP;

  -- 4b. Back-panel rate_book_items → materials (cost_unit 'sheet', show_in_back_panel)
  FOR r IN
    SELECT ri.id, ri.org_id, ri.name, ri.sheet_cost, ri.active
      FROM public.rate_book_items ri
      JOIN public.rate_book_categories rc ON rc.id = ri.category_id
     WHERE rc.item_type = 'back_panel_material'
       AND ri.material_id IS NULL
  LOOP
    INSERT INTO public.materials
      (org_id, name, cost_value, cost_unit, show_in_back_panel, active)
    VALUES (r.org_id, r.name, r.sheet_cost, 'sheet', true, r.active)
    RETURNING id INTO mid;
    UPDATE public.rate_book_items SET material_id = mid WHERE id = r.id;
  END LOOP;

  -- 4c. Door materials → materials (carry cost_value/cost_unit + solid-wood, show_in_door)
  FOR r IN
    SELECT id, org_id, material_name, cost_value, cost_unit, notes,
           solid_wood_component_id, bdft_per_unit, active
      FROM public.door_type_materials
     WHERE material_id IS NULL
  LOOP
    INSERT INTO public.materials
      (org_id, name, cost_value, cost_unit, notes,
       solid_wood_component_id, bdft_per_unit, show_in_door, active)
    VALUES (r.org_id, r.material_name, r.cost_value, r.cost_unit, r.notes,
            r.solid_wood_component_id, r.bdft_per_unit, true, r.active)
    RETURNING id INTO mid;
    UPDATE public.door_type_materials SET material_id = mid WHERE id = r.id;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
