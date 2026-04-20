-- ============================================================================
-- Migration 006 — Rate Book Phase 1
-- ============================================================================
-- Builds out the rate book data model per SYSTEM-MAP.md + BUILD-ORDER.md.
-- The existing migration 002 created rate_book_items + material_variants.
-- This migration:
--
--   1. Extends rate_book_items with material_mode, linear_cost, lump_cost,
--      hardware_note, material_description, confidence enum, and relaxes
--      the unit CHECK to cover DAY / HR / JOB in addition to LF / EA / SF.
--   2. Creates shop_labor_rates — the shop-wide dept labor rate table.
--   3. Creates rate_book_options — the stackable options layer (curved, rush,
--      paint-grade, etc.) with scope + effect.
--   4. Creates rate_book_item_options — many-to-many link between items and
--      the options that apply by default (one-job overrides live on the
--      estimate_line layer, not here).
--   5. Creates rate_book_item_history — the audit trail that populates the
--      History tab on the detail pane.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend rate_book_items.
-- ---------------------------------------------------------------------------

-- Drop any existing unit CHECK on rate_book_items, regardless of name, so we
-- can re-add the wider set cleanly. Postgres normalizes `IN (...)` to `= ANY
-- (ARRAY[...])` in stored constraint definitions, so we match on the column
-- being referenced rather than the literal text.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'rate_book_items'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) ILIKE '%unit%lf%'
         OR conname = 'rate_book_items_unit_check'
       )
  LOOP
    EXECUTE format('ALTER TABLE rate_book_items DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE rate_book_items
  ADD COLUMN IF NOT EXISTS material_mode text NOT NULL DEFAULT 'sheets'
    CHECK (material_mode IN ('sheets', 'linear', 'lump', 'none')),
  ADD COLUMN IF NOT EXISTS linear_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lump_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS material_description text,
  ADD COLUMN IF NOT EXISTS hardware_note text,
  ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT 'untested'
    CHECK (confidence IN ('untested', 'few_jobs', 'well_tested', 'looking_weird'));

-- Re-add the unit constraint with the expanded set.
ALTER TABLE rate_book_items
  ADD CONSTRAINT rate_book_items_unit_check
  CHECK (unit IN ('lf', 'each', 'sf', 'day', 'hr', 'job'));

-- ---------------------------------------------------------------------------
-- 2. Shop labor rates — one row per dept, per org.
-- ---------------------------------------------------------------------------
-- Defaults per BUILD-ORDER Phase 1:
--   Engineering $95 · CNC $85 · Assembly $85 · Finish $90 · Install $80
-- Rates are seeded per-org from lib/rate-book-seed.ts on first use.

CREATE TABLE IF NOT EXISTS shop_labor_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  dept text NOT NULL CHECK (dept IN ('eng', 'cnc', 'assembly', 'finish', 'install')),
  rate_per_hour numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (org_id, dept)
);
CREATE INDEX IF NOT EXISTS idx_shop_labor_rates_org ON shop_labor_rates(org_id);

-- ---------------------------------------------------------------------------
-- 3. Options layer (stackable modifiers with scope + effect).
-- ---------------------------------------------------------------------------
-- One row per defined option. A line picks them up at the estimate level.
-- Scope limits which items the option is available on; effect drives the
-- math engine when it's applied.

CREATE TABLE IF NOT EXISTS rate_book_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  key text NOT NULL,                -- short stable key, e.g. 'curved'
  name text NOT NULL,               -- human label, e.g. 'Curved'
  -- Scope values:
  --   shop_wide       → available on every item
  --   category:<uuid> → only items inside that rate_book_category
  --   item:<uuid>     → pinned to one item
  scope text NOT NULL DEFAULT 'shop_wide',
  -- Effect types:
  --   hours_multiplier    → multiplies a dept's base hours (effect_target = dept)
  --   rate_multiplier     → multiplies the line's labor $ total (target unused)
  --   material_multiplier → multiplies material $ (effect_target = 'all' or variant)
  --   flat_add            → adds flat $ to the line (target unused)
  --   per_unit_add        → adds $ per line quantity unit
  --   flag                → zero math effect; just tags the line
  effect_type text NOT NULL
    CHECK (effect_type IN ('hours_multiplier', 'rate_multiplier',
      'material_multiplier', 'flat_add', 'per_unit_add', 'flag')),
  effect_value numeric NOT NULL DEFAULT 0,
  effect_target text,               -- dept name or variant context
  notes text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (org_id, key)
);
CREATE INDEX IF NOT EXISTS idx_rate_book_options_org ON rate_book_options(org_id);

CREATE TABLE IF NOT EXISTS rate_book_item_options (
  rate_book_item_id uuid NOT NULL REFERENCES rate_book_items(id) ON DELETE CASCADE,
  rate_book_option_id uuid NOT NULL REFERENCES rate_book_options(id) ON DELETE CASCADE,
  is_default boolean DEFAULT false,  -- if true, applies to every new line using this item
  PRIMARY KEY (rate_book_item_id, rate_book_option_id)
);

-- ---------------------------------------------------------------------------
-- 4. Item history — the audit trail behind the History tab.
-- ---------------------------------------------------------------------------
-- Every edit to a rate_book_item writes one row here. field_changes is a jsonb
-- object of { field_name: { from: ..., to: ... } }. apply_scope captures the
-- modal's radio choice (this / category / shop_wide) so the suggestions loop
-- later can reason about how the change propagated.

CREATE TABLE IF NOT EXISTS rate_book_item_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_book_item_id uuid NOT NULL REFERENCES rate_book_items(id) ON DELETE CASCADE,
  changed_at timestamptz DEFAULT now(),
  changed_by uuid,
  field_changes jsonb NOT NULL,
  reason text,
  apply_scope text NOT NULL DEFAULT 'this'
    CHECK (apply_scope IN ('this', 'category', 'shop_wide'))
);
CREATE INDEX IF NOT EXISTS idx_rate_book_item_history_item
  ON rate_book_item_history(rate_book_item_id, changed_at DESC);

COMMIT;
