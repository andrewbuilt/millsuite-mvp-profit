-- ============================================================================
-- Migration 019 — Phase 12 schema prep (composer + walkthroughs)
-- ============================================================================
-- Per BUILD-ORDER Phase 12 item 1 + specs/add-line-composer/README.md.
--
-- Scope of THIS migration (item 1 only — nothing from items 2–11):
--
--   1. public.users.onboarded_at    timestamptz NULL — null = show welcome
--                                    overlay on first app mount; set to
--                                    NOW() once shop-rate + base-cabinet
--                                    walkthroughs complete.
--      public.users.onboarding_step text NULL — "welcome" | "shop_rate" |
--                                    "base_cabinet" | null once done.
--      Lives on users (not a separate profiles table — this repo uses
--      public.users as the auth extension, keyed on auth_user_id).
--
--   2. orgs.last_used_slots_by_product jsonb NULL — shop-wide per-product
--      slot carry-over. Rationale: a shop's typical spec is a shop
--      property. A new estimator on the team should pick up the shop's
--      defaults rather than hit empty slots. Per-operator would mean
--      two estimators carrying their own preferences, which diverges
--      on the "one shop, one playbook" mental model the spec leans on.
--      Shape: { base: {...slots}, upper: {...slots}, full: {...slots} }.
--      Every saved composer line overwrites its product's entry.
--
--   3. rate_book_items.door_labor_hours_eng/cnc/assembly/finish numeric
--      NOT NULL DEFAULT 0. PER-DOOR values (post-divide-by-4 at the
--      walkthrough layer). Kept separate from base_labor_hours_* because
--      that column is per-unit (per-LF for carcasses, per-each
--      elsewhere) and a door "unit" is one door — overloading it would
--      make the 4-door calibration contract invisible. These only
--      populate when the item's category.item_type = 'door_style'; on
--      other items they stay 0 and are ignored by the composer math.
--
--      Composer math at line compute (read side):
--        door_labor_hours_dept × product.doorsPerLf
--                               × product.doorLaborMultiplier × qty
--
--   4. New table rate_book_finish_breakdown — one row per
--      (finish_item × product_category) with hrs + 4 material buckets
--      (primer / paint / stain / lacquer) stored per-LF. Captures the
--      walkthrough output. Partial calibration is a first-class state:
--      missing row = "not calibrated for that cab height," composer
--      surfaces the uncalibrated-combo hatch.
--
--      Can't reuse rate_book_material_variants — that table is scoped to
--      per-item material *swaps* with labor multipliers, a different
--      axis than finish-consumable breakdown × cab height.
--
--      RLS: authenticated role + EXISTS on the parent rate_book_items
--      row — same pattern as 017 + 018. Enabled as part of the
--      migration so CO/approval-slot-style 403s never land here.
--
-- Out of scope for 019 (deferred, per Andrew's explicit call):
--   - subprojects.defaults { consumablesPct, wastePct } — lands with
--     item 6 composer in its own small migration.
--   - orgs.consumable_markup_pct default flip (15 → 10 or prototype
--     adopts 15) — decide when composer lands, not here.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- 1. users — onboarding flag columns ---------------------------------------

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarded_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS onboarding_step text        NULL;

-- 2. orgs — shop-wide last-used slots --------------------------------------

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS last_used_slots_by_product jsonb NULL;

-- 3. rate_book_items — door-style per-dept labor (per-door, post-÷4) -------

ALTER TABLE public.rate_book_items
  ADD COLUMN IF NOT EXISTS door_labor_hours_eng      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS door_labor_hours_cnc      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS door_labor_hours_assembly numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS door_labor_hours_finish   numeric NOT NULL DEFAULT 0;

-- 4. rate_book_finish_breakdown --------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_book_finish_breakdown (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_book_item_id   uuid NOT NULL REFERENCES public.rate_book_items(id) ON DELETE CASCADE,
  product_category    text NOT NULL
    CHECK (product_category IN ('base', 'upper', 'full')),
  labor_hr_per_lf     numeric NOT NULL DEFAULT 0,
  primer_cost_per_lf  numeric NOT NULL DEFAULT 0,
  paint_cost_per_lf   numeric NOT NULL DEFAULT 0,
  stain_cost_per_lf   numeric NOT NULL DEFAULT 0,
  lacquer_cost_per_lf numeric NOT NULL DEFAULT 0,
  calibrated_at       timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_book_item_id, product_category)
);
CREATE INDEX IF NOT EXISTS idx_rate_book_finish_breakdown_item
  ON public.rate_book_finish_breakdown(rate_book_item_id);

-- RLS — authenticated + EXISTS on the parent item (same pattern as 017/018).

ALTER TABLE public.rate_book_finish_breakdown ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_book_finish_breakdown_select_authenticated ON public.rate_book_finish_breakdown;
DROP POLICY IF EXISTS rate_book_finish_breakdown_insert_authenticated ON public.rate_book_finish_breakdown;
DROP POLICY IF EXISTS rate_book_finish_breakdown_update_authenticated ON public.rate_book_finish_breakdown;
DROP POLICY IF EXISTS rate_book_finish_breakdown_delete_authenticated ON public.rate_book_finish_breakdown;

CREATE POLICY rate_book_finish_breakdown_select_authenticated
  ON public.rate_book_finish_breakdown FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rate_book_items i
     WHERE i.id = rate_book_finish_breakdown.rate_book_item_id
  ));

CREATE POLICY rate_book_finish_breakdown_insert_authenticated
  ON public.rate_book_finish_breakdown FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.rate_book_items i
     WHERE i.id = rate_book_finish_breakdown.rate_book_item_id
  ));

CREATE POLICY rate_book_finish_breakdown_update_authenticated
  ON public.rate_book_finish_breakdown FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rate_book_items i
     WHERE i.id = rate_book_finish_breakdown.rate_book_item_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.rate_book_items i
     WHERE i.id = rate_book_finish_breakdown.rate_book_item_id
  ));

CREATE POLICY rate_book_finish_breakdown_delete_authenticated
  ON public.rate_book_finish_breakdown FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rate_book_items i
     WHERE i.id = rate_book_finish_breakdown.rate_book_item_id
  ));

COMMIT;
