-- ============================================================================
-- 038 — Door pricing v2
-- ============================================================================
-- Replaces the door-style + ext-material + exterior-finish trio with a
-- 1:N:N model:
--
--   door_types
--     ↓ (1 type → many materials)
--   door_type_materials
--     ↓ (1 material → many finishes)
--   door_type_material_finishes
--
-- Door labor + hardware live on door_types. Material cost lives on
-- door_type_materials with a unit (sheet/lf/bf/ea/lump). Finish per-door
-- labor + per-door material cost live on door_type_material_finishes.
--
-- Existing rate_book_items rows under category.item_type='door_style' are
-- copied into door_types so saved estimate_lines that referenced their
-- ids still resolve a name. Old door_style rows are flagged inactive but
-- not deleted — staleness banner fires for any composer line that still
-- carries the legacy slot keys (doorStyle / doorMaterial / exteriorFinish)
-- so the operator re-picks under the new model.
-- ============================================================================

BEGIN;

-- 1. door_types ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.door_types (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  name                   text NOT NULL,
  labor_hours_eng        numeric NOT NULL DEFAULT 0,
  labor_hours_cnc        numeric NOT NULL DEFAULT 0,
  labor_hours_assembly   numeric NOT NULL DEFAULT 0,
  labor_hours_finish     numeric NOT NULL DEFAULT 0,
  hardware_cost          numeric NOT NULL DEFAULT 0,
  calibrated             boolean NOT NULL DEFAULT false,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_door_types_org ON public.door_types(org_id) WHERE active;

-- 2. door_type_materials ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.door_type_materials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  door_type_id    uuid NOT NULL REFERENCES public.door_types(id) ON DELETE CASCADE,
  material_name   text NOT NULL,
  cost_value      numeric NOT NULL DEFAULT 0,
  cost_unit       text NOT NULL DEFAULT 'sheet'
    CHECK (cost_unit IN ('sheet','lf','bf','ea','lump')),
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_door_type_materials_org  ON public.door_type_materials(org_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_door_type_materials_type ON public.door_type_materials(door_type_id) WHERE active;

-- 3. door_type_material_finishes -------------------------------------------

CREATE TABLE IF NOT EXISTS public.door_type_material_finishes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL,
  door_type_material_id    uuid NOT NULL REFERENCES public.door_type_materials(id) ON DELETE CASCADE,
  finish_name              text NOT NULL,
  labor_hours_per_door     numeric NOT NULL DEFAULT 0,
  material_per_door        numeric NOT NULL DEFAULT 0,
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_door_finishes_org      ON public.door_type_material_finishes(org_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_door_finishes_material ON public.door_type_material_finishes(door_type_material_id) WHERE active;

-- 4. RLS — same shape as migration 020 (org-scoped via users.auth_user_id) -

ALTER TABLE public.door_types                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.door_type_materials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.door_type_material_finishes   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS door_types_select ON public.door_types;
DROP POLICY IF EXISTS door_types_insert ON public.door_types;
DROP POLICY IF EXISTS door_types_update ON public.door_types;
DROP POLICY IF EXISTS door_types_delete ON public.door_types;

CREATE POLICY door_types_select ON public.door_types FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_types.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY door_types_insert ON public.door_types FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_types.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY door_types_update ON public.door_types FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_types.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_types.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY door_types_delete ON public.door_types FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_types.org_id AND u.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS door_type_materials_select ON public.door_type_materials;
DROP POLICY IF EXISTS door_type_materials_insert ON public.door_type_materials;
DROP POLICY IF EXISTS door_type_materials_update ON public.door_type_materials;
DROP POLICY IF EXISTS door_type_materials_delete ON public.door_type_materials;

CREATE POLICY door_type_materials_select ON public.door_type_materials FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_materials.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY door_type_materials_insert ON public.door_type_materials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_materials.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY door_type_materials_update ON public.door_type_materials FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_materials.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_materials.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY door_type_materials_delete ON public.door_type_materials FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_materials.org_id AND u.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS door_finishes_select ON public.door_type_material_finishes;
DROP POLICY IF EXISTS door_finishes_insert ON public.door_type_material_finishes;
DROP POLICY IF EXISTS door_finishes_update ON public.door_type_material_finishes;
DROP POLICY IF EXISTS door_finishes_delete ON public.door_type_material_finishes;

CREATE POLICY door_finishes_select ON public.door_type_material_finishes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_material_finishes.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY door_finishes_insert ON public.door_type_material_finishes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_material_finishes.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY door_finishes_update ON public.door_type_material_finishes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_material_finishes.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_material_finishes.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY door_finishes_delete ON public.door_type_material_finishes FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = door_type_material_finishes.org_id AND u.auth_user_id = auth.uid()));

-- 5. Migrate existing door_style rate_book_items into door_types -----------
-- Each existing door_style item creates one door_types row with the same
-- name + labor + hardware. Materials and finishes are NOT auto-attached;
-- operators wire them via the composer's new "+ Add material" / "+ Add
-- finish" affordances or the rate-book detail page.
--
-- Skip rows whose name already lives in door_types (idempotent re-runs).

INSERT INTO public.door_types (
  org_id, name,
  labor_hours_eng, labor_hours_cnc, labor_hours_assembly, labor_hours_finish,
  hardware_cost, calibrated, active
)
SELECT
  ri.org_id,
  ri.name,
  COALESCE(ri.door_labor_hours_eng, 0),
  COALESCE(ri.door_labor_hours_cnc, 0),
  COALESCE(ri.door_labor_hours_assembly, 0),
  COALESCE(ri.door_labor_hours_finish, 0),
  COALESCE(ri.hardware_cost, 0),
  (
    COALESCE(ri.door_labor_hours_eng, 0)
    + COALESCE(ri.door_labor_hours_cnc, 0)
    + COALESCE(ri.door_labor_hours_assembly, 0)
    + COALESCE(ri.door_labor_hours_finish, 0)
  ) > 0,
  COALESCE(ri.active, true)
FROM public.rate_book_items ri
JOIN public.rate_book_categories rc ON rc.id = ri.category_id
WHERE rc.item_type = 'door_style'
  AND NOT EXISTS (
    SELECT 1 FROM public.door_types dt
    WHERE dt.org_id = ri.org_id
      AND lower(dt.name) = lower(ri.name)
  );

-- 6. Inactivate the legacy door_style rate_book_items -----------------------
-- The rows stay around so legacy lookups by id still resolve a name on
-- in-flight estimate lines, but they no longer surface in any active list.
-- A follow-up cleanup migration can DELETE them once all live composer
-- lines have been re-picked under the v2 model.

UPDATE public.rate_book_items ri
   SET active = false,
       updated_at = now()
  FROM public.rate_book_categories rc
 WHERE rc.id = ri.category_id
   AND rc.item_type = 'door_style'
   AND ri.active = true;

COMMIT;
