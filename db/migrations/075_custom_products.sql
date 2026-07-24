-- ============================================================================
-- 075 — Custom products (rate-book overhaul, chunk E: the product builder)
-- ============================================================================
-- Products move from hardcoded lib/products.ts to DATA. A custom product is a
-- simple calibrated shape: labor hours/unit by dept + N material slots (each
-- slot picks a catalog material at line time, consumed at a per-unit rate) +
-- optional LED (per LF) and hardware. The built-in cabinet products (base/
-- upper/full — door/drawer/open-section logic) stay hardcoded; custom products
-- cover the "labor + materials + qty" case (floating shelf, etc.).
--
-- material_slots jsonb is the shared slot-definition source — the composer
-- renders a dropdown per slot and the CO spec-change modal derives its
-- changeable slots from the same array.
--   material_slots: [{ key, label, show_in, consumption_per_unit }]
--     key                 stable slot id (product_slots stores custom_<key> → material id)
--     label               display ("Shelf material")
--     show_in             which catalog flag seeds the quick-grab list
--                         (carcass|door|back_panel|shelf|any)
--     consumption_per_unit material cost-units consumed per product unit
--                         (e.g. 0.1 sheet per LF) → cost = qty × this × material.cost_value
--
-- Idempotent. Run on prod before the code that reads custom_products.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.custom_products (
  id                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                         uuid        NOT NULL,
  name                           text        NOT NULL,
  unit                           text        NOT NULL DEFAULT 'lf'
    CHECK (unit IN ('lf','each','sqft')),
  -- Labor hours consumed per product unit, by dept (eng/cnc/assembly/finish;
  -- install billed separately, same as the built-in cabinet products).
  labor_hours_eng_per_unit       numeric     NOT NULL DEFAULT 0,
  labor_hours_cnc_per_unit       numeric     NOT NULL DEFAULT 0,
  labor_hours_assembly_per_unit  numeric     NOT NULL DEFAULT 0,
  labor_hours_finish_per_unit    numeric     NOT NULL DEFAULT 0,
  hardware_cost_per_unit         numeric     NOT NULL DEFAULT 0,
  -- When true, the composer shows the LED section on this product's lines.
  led_enabled                    boolean     NOT NULL DEFAULT false,
  -- [{ key, label, show_in, consumption_per_unit }]
  material_slots                 jsonb       NOT NULL DEFAULT '[]'::jsonb,
  calibrated                     boolean     NOT NULL DEFAULT false,
  confidence                     text        NOT NULL DEFAULT 'untested',
  active                         boolean     NOT NULL DEFAULT true,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_products_org
  ON public.custom_products(org_id)
  WHERE active;

-- RLS (org-scoped, mirrors led_types / door_types) --------------------------

ALTER TABLE public.custom_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_products_select ON public.custom_products;
DROP POLICY IF EXISTS custom_products_insert ON public.custom_products;
DROP POLICY IF EXISTS custom_products_update ON public.custom_products;
DROP POLICY IF EXISTS custom_products_delete ON public.custom_products;

CREATE POLICY custom_products_select ON public.custom_products FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = custom_products.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY custom_products_insert ON public.custom_products FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = custom_products.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY custom_products_update ON public.custom_products FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = custom_products.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = custom_products.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY custom_products_delete ON public.custom_products FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = custom_products.org_id AND u.auth_user_id = auth.uid()));

COMMIT;

NOTIFY pgrst, 'reload schema';
