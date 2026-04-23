-- ============================================================================
-- Migration 020 — Phase 12 item 6 schema (composer · PR 1 of 2)
-- ============================================================================
-- Columns + tables for the add-line composer. Nothing reads or writes to
-- them yet — PR 2 wires the component and flips the subproject editor
-- over. This migration is strictly additive so it's safe to land ahead
-- of the code.
--
-- What's added:
--
--   1. estimate_lines.product_key  text NULL
--      estimate_lines.product_slots jsonb NULL
--      When a line comes from the composer the product key is stamped
--      ('base' / 'upper' / 'full' / 'drawer' / 'led' / 'countertop' — see
--      lib/products.ts) and the slot payload is stored verbatim so the
--      composer can round-trip edit. Freeform lines (Phase 2 inline entry,
--      kept per the "freeform first-class" directive in SYSTEM-MAP) leave
--      both columns NULL. No existing Phase-2 column is renamed or
--      touched — material_mode_override / linear_cost_override /
--      lump_cost_override / dept_hour_overrides / finish_specs /
--      material_description / install_mode / install_params all stay
--      in place for the freeform path.
--
--   2. subprojects.defaults jsonb NULL
--      Per-subproject composer defaults. Shape: { consumablesPct,
--      wastePct }. App-layer initialization on subproject create pulls
--      consumablesPct from COALESCE(orgs.consumable_markup_pct, 10)
--      (explicit decision — existing shop setting wins; fallback is the
--      prototype default). wastePct hardcodes to 5 — no existing org
--      column to coalesce with. Composer reads this column only; it
--      never touches orgs.consumable_markup_pct.
--
--   3. rate_book_carcass_materials — new table.
--      Per-org template list of carcass sheet goods: name + $/sheet +
--      sheets/LF. Separate from rate_book_material_variants (which is
--      per-item material swaps) because the composer treats carcass
--      material as a flat shop-wide template list, not a per-item
--      variant. Schema mirrors the prototype's rateBook.carcassMaterials
--      shape verbatim.
--
--   4. rate_book_ext_materials — new table.
--      Per-org template list of face/ext sheet goods: name + $/sheet.
--      No sheets/LF column — sheets per LF for face material comes from
--      the product (lib/products.ts: sheetsPerLfFace varies by
--      Base/Upper/Full).
--
--   5. RLS on both new tables — authenticated + EXISTS via users to the
--      row's org_id, so Org A can't read Org B's material list. Pattern
--      matches the migration 017/018/019 EXISTS shape, adapted to an
--      org-scoped check (no direct parent row).
--
-- Out of scope for 020 (lands in PR 2 alongside the component):
--   - Any default seed rows for carcass / ext materials. The rate book
--     still starts empty per the "grows from use" directive — composer
--     UI provides the inline "+ Add new material" path.
--   - Subproject-create hook that fills subprojects.defaults on insert.
--     That's app-layer; PR 2 owns it.
--   - Any reads of product_key / product_slots — the composer is the
--     only reader and it lands in PR 2.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- 1. estimate_lines — composer payload columns -----------------------------

ALTER TABLE public.estimate_lines
  ADD COLUMN IF NOT EXISTS product_key   text  NULL,
  ADD COLUMN IF NOT EXISTS product_slots jsonb NULL;

-- Soft check — allowed product keys match lib/products.ts. NULL passes the
-- constraint so freeform lines are unaffected. Drop-and-recreate so it's
-- idempotent across re-runs.
ALTER TABLE public.estimate_lines
  DROP CONSTRAINT IF EXISTS estimate_lines_product_key_check;
ALTER TABLE public.estimate_lines
  ADD CONSTRAINT estimate_lines_product_key_check
    CHECK (product_key IS NULL OR product_key IN (
      'base', 'upper', 'full', 'drawer', 'led', 'countertop'
    ));

-- 2. subprojects.defaults --------------------------------------------------

ALTER TABLE public.subprojects
  ADD COLUMN IF NOT EXISTS defaults jsonb NULL;

-- 3. rate_book_carcass_materials -------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_book_carcass_materials (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL,
  name           text        NOT NULL,
  sheet_cost     numeric     NOT NULL DEFAULT 0,
  sheets_per_lf  numeric     NOT NULL DEFAULT 0,
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_book_carcass_materials_org
  ON public.rate_book_carcass_materials(org_id)
  WHERE active;

-- 4. rate_book_ext_materials -----------------------------------------------
-- No sheets_per_lf column — face sheets per LF comes from the product
-- (lib/products.ts). Adding it here would be dead data.

CREATE TABLE IF NOT EXISTS public.rate_book_ext_materials (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL,
  name        text        NOT NULL,
  sheet_cost  numeric     NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_book_ext_materials_org
  ON public.rate_book_ext_materials(org_id)
  WHERE active;

-- 5. RLS on both new tables ------------------------------------------------
-- Org-scoped: a row is reachable when the authenticated user's users row
-- belongs to the row's org. Matches how rate-book data is already expected
-- to partition across shops; drops into the same shape as 017/018/019
-- (authenticated role + EXISTS predicate) but with a users-to-org check
-- rather than a parent-row check, because these tables have no parent.

ALTER TABLE public.rate_book_carcass_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_book_carcass_materials_select_authenticated ON public.rate_book_carcass_materials;
DROP POLICY IF EXISTS rate_book_carcass_materials_insert_authenticated ON public.rate_book_carcass_materials;
DROP POLICY IF EXISTS rate_book_carcass_materials_update_authenticated ON public.rate_book_carcass_materials;
DROP POLICY IF EXISTS rate_book_carcass_materials_delete_authenticated ON public.rate_book_carcass_materials;

CREATE POLICY rate_book_carcass_materials_select_authenticated
  ON public.rate_book_carcass_materials FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_carcass_materials.org_id
       AND u.auth_user_id = auth.uid()
  ));

CREATE POLICY rate_book_carcass_materials_insert_authenticated
  ON public.rate_book_carcass_materials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_carcass_materials.org_id
       AND u.auth_user_id = auth.uid()
  ));

CREATE POLICY rate_book_carcass_materials_update_authenticated
  ON public.rate_book_carcass_materials FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_carcass_materials.org_id
       AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_carcass_materials.org_id
       AND u.auth_user_id = auth.uid()
  ));

CREATE POLICY rate_book_carcass_materials_delete_authenticated
  ON public.rate_book_carcass_materials FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_carcass_materials.org_id
       AND u.auth_user_id = auth.uid()
  ));

ALTER TABLE public.rate_book_ext_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_book_ext_materials_select_authenticated ON public.rate_book_ext_materials;
DROP POLICY IF EXISTS rate_book_ext_materials_insert_authenticated ON public.rate_book_ext_materials;
DROP POLICY IF EXISTS rate_book_ext_materials_update_authenticated ON public.rate_book_ext_materials;
DROP POLICY IF EXISTS rate_book_ext_materials_delete_authenticated ON public.rate_book_ext_materials;

CREATE POLICY rate_book_ext_materials_select_authenticated
  ON public.rate_book_ext_materials FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_ext_materials.org_id
       AND u.auth_user_id = auth.uid()
  ));

CREATE POLICY rate_book_ext_materials_insert_authenticated
  ON public.rate_book_ext_materials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_ext_materials.org_id
       AND u.auth_user_id = auth.uid()
  ));

CREATE POLICY rate_book_ext_materials_update_authenticated
  ON public.rate_book_ext_materials FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_ext_materials.org_id
       AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_ext_materials.org_id
       AND u.auth_user_id = auth.uid()
  ));

CREATE POLICY rate_book_ext_materials_delete_authenticated
  ON public.rate_book_ext_materials FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.org_id = rate_book_ext_materials.org_id
       AND u.auth_user_id = auth.uid()
  ));

COMMIT;
