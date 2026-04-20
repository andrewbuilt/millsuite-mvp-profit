-- ============================================================================
-- Migration 007 — Estimate Lines Phase 2
-- ============================================================================
-- Extends estimate_lines (from migration 002) to support the Phase 2 editor:
--
--   - Freeform lines (any unit, any dept-hours, lump material).
--   - Per-line overrides of the rate book's material mode + costs + hours.
--   - Install mode per line (per_man_per_day / per_box / flat) with params.
--   - Structured finish specs (jsonb) alongside the legacy callouts text[].
--   - Line-level options (M:N) with one-job effect-value overrides.
--
-- The rate book still holds the baseline. These columns are strictly OVERRIDES
-- — null means "inherit from the rate book item". Freeform lines (no
-- rate_book_item_id) populate the fields directly.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend estimate_lines.
-- ---------------------------------------------------------------------------

ALTER TABLE estimate_lines
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS material_mode_override text
    CHECK (material_mode_override IN ('sheets', 'linear', 'lump', 'none')),
  ADD COLUMN IF NOT EXISTS linear_cost_override numeric,
  ADD COLUMN IF NOT EXISTS lump_cost_override numeric,
  -- dept_hour_overrides shape:
  --   { "eng": 0.5, "cnc": 1.0, "assembly": 2.0, "finish": 0.25, "install": 0.5 }
  -- Null keys inherit from the rate book item.
  ADD COLUMN IF NOT EXISTS dept_hour_overrides jsonb,
  -- Install mode and params (per-line):
  --   per_man_per_day: { days: n, men: n, rate: n }
  --   per_box:         { boxes: n, rate_per_box: n }
  --   flat:            { amount: n }
  -- Null install_mode means "use labor-hours like any other line" (no install).
  ADD COLUMN IF NOT EXISTS install_mode text
    CHECK (install_mode IN ('per_man_per_day', 'per_box', 'flat')),
  ADD COLUMN IF NOT EXISTS install_params jsonb,
  -- Structured finish callouts. Shape per entry:
  --   { material, finish, edge, notes }  — all optional
  -- Kept separate from the legacy `callouts text[]` so both can coexist
  -- during the migration window.
  ADD COLUMN IF NOT EXISTS finish_specs jsonb,
  -- Freeform-line material fields (used when rate_book_item_id is null).
  ADD COLUMN IF NOT EXISTS material_description text;

-- ---------------------------------------------------------------------------
-- 2. Line-level options (M:N with override values).
-- ---------------------------------------------------------------------------
-- One row per option applied to one line. effect_value_override is null by
-- default — the option fires with its rate-book effect_value. Non-null flips
-- the value just for this line (e.g. rush 1.15 → 1.25 for this line only).

CREATE TABLE IF NOT EXISTS estimate_line_options (
  estimate_line_id uuid NOT NULL REFERENCES estimate_lines(id) ON DELETE CASCADE,
  rate_book_option_id uuid NOT NULL REFERENCES rate_book_options(id) ON DELETE CASCADE,
  effect_value_override numeric,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (estimate_line_id, rate_book_option_id)
);
CREATE INDEX IF NOT EXISTS idx_estimate_line_options_line
  ON estimate_line_options(estimate_line_id);

COMMIT;
