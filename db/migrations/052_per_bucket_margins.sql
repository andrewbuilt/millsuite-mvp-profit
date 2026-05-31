-- ============================================================================
-- 052 — Per-bucket margins (labor / material / consumables)
-- ============================================================================
-- Replaces the single project margin knob (projects.target_margin_pct,
-- with orgs.profit_margin_pct as the org default) with three independent
-- true-gross-margin knobs so a shop can mark up materials differently
-- from labor. Mapping of the six cost buckets to the three knobs:
--
--   labor_margin_pct      → labor + install        (shop time)
--   material_margin_pct   → material + hardware + options (purchased goods + upcharges)
--   consumable_margin_pct → consumables
--
-- All three are TRUE gross margins: bucket_price = bucket_cost / (1 - m/100).
-- The project price is the sum of the three bucket prices.
--
-- NULL on a project column = inherit the org default. NULL on an org
-- column = fall back to a 35% default in code. This mirrors the existing
-- target_margin_pct inherit semantics (migration 027).
--
-- ── Backward compatibility (no price changes on migrate) ──
-- True margin is additive across buckets: when all three knobs equal the
-- same m, Σ (cost_i / (1 - m)) == (Σ cost_i) / (1 - m) == the old single-
-- knob price. So we BACKFILL each org's three new defaults from its
-- current profit_margin_pct (falling back to 35), and backfill each
-- project's three knobs from its pinned target_margin_pct (leaving NULL —
-- i.e. inherit — when the project never pinned one). Result: every
-- existing estimate prices identically until someone tunes a knob.
--
-- target_margin_pct and profit_margin_pct are intentionally LEFT IN PLACE
-- as the legacy fallback; a later migration can drop them once all read
-- paths are confirmed off them.
--
-- Rollback:
--   ALTER TABLE public.projects
--     DROP COLUMN IF EXISTS labor_margin_pct,
--     DROP COLUMN IF EXISTS material_margin_pct,
--     DROP COLUMN IF EXISTS consumable_margin_pct;
--   ALTER TABLE public.orgs
--     DROP COLUMN IF EXISTS labor_margin_pct,
--     DROP COLUMN IF EXISTS material_margin_pct,
--     DROP COLUMN IF EXISTS consumable_margin_pct;
-- ============================================================================

BEGIN;

-- ── Org-level defaults ──────────────────────────────────────────────────────
ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS labor_margin_pct      numeric NULL,
  ADD COLUMN IF NOT EXISTS material_margin_pct   numeric NULL,
  ADD COLUMN IF NOT EXISTS consumable_margin_pct numeric NULL;

ALTER TABLE public.orgs
  DROP CONSTRAINT IF EXISTS orgs_labor_margin_pct_range,
  DROP CONSTRAINT IF EXISTS orgs_material_margin_pct_range,
  DROP CONSTRAINT IF EXISTS orgs_consumable_margin_pct_range;

ALTER TABLE public.orgs
  ADD CONSTRAINT orgs_labor_margin_pct_range
    CHECK (labor_margin_pct IS NULL OR (labor_margin_pct >= 0 AND labor_margin_pct < 100)),
  ADD CONSTRAINT orgs_material_margin_pct_range
    CHECK (material_margin_pct IS NULL OR (material_margin_pct >= 0 AND material_margin_pct < 100)),
  ADD CONSTRAINT orgs_consumable_margin_pct_range
    CHECK (consumable_margin_pct IS NULL OR (consumable_margin_pct >= 0 AND consumable_margin_pct < 100));

-- Backfill org defaults from the existing single profit margin so nothing
-- re-prices on migrate. COALESCE guards orgs that never set profit_margin_pct.
UPDATE public.orgs
SET
  labor_margin_pct      = COALESCE(labor_margin_pct,      profit_margin_pct, 35),
  material_margin_pct   = COALESCE(material_margin_pct,   profit_margin_pct, 35),
  consumable_margin_pct = COALESCE(consumable_margin_pct, profit_margin_pct, 35);

-- ── Project-level pins (NULL = inherit org default) ─────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS labor_margin_pct      numeric NULL,
  ADD COLUMN IF NOT EXISTS material_margin_pct   numeric NULL,
  ADD COLUMN IF NOT EXISTS consumable_margin_pct numeric NULL;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_labor_margin_pct_range,
  DROP CONSTRAINT IF EXISTS projects_material_margin_pct_range,
  DROP CONSTRAINT IF EXISTS projects_consumable_margin_pct_range;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_labor_margin_pct_range
    CHECK (labor_margin_pct IS NULL OR (labor_margin_pct >= 0 AND labor_margin_pct < 100)),
  ADD CONSTRAINT projects_material_margin_pct_range
    CHECK (material_margin_pct IS NULL OR (material_margin_pct >= 0 AND material_margin_pct < 100)),
  ADD CONSTRAINT projects_consumable_margin_pct_range
    CHECK (consumable_margin_pct IS NULL OR (consumable_margin_pct >= 0 AND consumable_margin_pct < 100));

-- Backfill project pins: a project that PINNED a single target margin keeps
-- that exact price by pinning all three buckets to the same value. A project
-- that inherited (target_margin_pct IS NULL) stays NULL on all three so it
-- keeps inheriting — now from the org's three new defaults.
UPDATE public.projects
SET
  labor_margin_pct      = COALESCE(labor_margin_pct,      target_margin_pct),
  material_margin_pct   = COALESCE(material_margin_pct,   target_margin_pct),
  consumable_margin_pct = COALESCE(consumable_margin_pct, target_margin_pct)
WHERE target_margin_pct IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
