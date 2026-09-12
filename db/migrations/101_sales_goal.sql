-- ============================================================================
-- 101 — sales goal: the three knobs behind the monthly cash target
-- ============================================================================
-- Andrew, 2026-09-12: "Needed" on /payments summed the scheduled draws, which
-- is "just adding up what is brought in, makes no sense." A target you set by
-- adding up what you already planned to collect isn't a target.
--
-- The model he specified: every dollar that comes in splits three ways —
-- overhead, material (COGS) and profit. So the revenue that covers a month of
-- fixed costs is:
--
--     goal = monthlyFixed / (1 - materialPct - profitPct)
--
-- ⛔ ALL THREE COLUMNS ARE NULLABLE AND THAT IS THE DESIGN. Unset means "this
-- shop hasn't set up a goal", and the UI shows a nudge. A DEFAULT here would
-- manufacture a confident, wrong target for every existing org on the day the
-- migration ran — and a wrong revenue target is worse than no target, because
-- someone might price against it.
--
--   goal_material_pct           percent (0-100), e.g. 32 = 32% of revenue
--   goal_profit_pct             percent (0-100). ASSUMED, blended, org-wide.
--                               Andrew: "we don't really know profit until the
--                               end of the job. It would need to be assumed."
--   goal_fixed_monthly_override dollars/month. NULL = derive from the
--                               shop-rate setup (overhead + team comp ÷ 12),
--                               which is the default path — Andrew chose
--                               DERIVED over typed so it can't go stale.
--
-- Units match `profit_margin_pct` (percent, not fraction). Mixing the two
-- would be a 100× error in a revenue target, so lib/sales-goal takes percents
-- and converts once, in one place.
--
-- ROLLBACK:
--   ALTER TABLE public.orgs DROP COLUMN IF EXISTS goal_material_pct;
--   ALTER TABLE public.orgs DROP COLUMN IF EXISTS goal_profit_pct;
--   ALTER TABLE public.orgs DROP COLUMN IF EXISTS goal_fixed_monthly_override;
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS goal_material_pct numeric,
  ADD COLUMN IF NOT EXISTS goal_profit_pct numeric,
  ADD COLUMN IF NOT EXISTS goal_fixed_monthly_override numeric;

COMMENT ON COLUMN public.orgs.goal_material_pct IS
  'Share of revenue expected to go to material, as a PERCENT (0-100). NULL = goal not set up.';
COMMENT ON COLUMN public.orgs.goal_profit_pct IS
  'Target profit as a PERCENT of revenue (0-100). Assumed and blended — not measured per job.';
COMMENT ON COLUMN public.orgs.goal_fixed_monthly_override IS
  'Monthly fixed cost in dollars, overriding the figure derived from overhead + team comp. NULL = derive.';

-- No RLS changes: `orgs` is already locked to the caller's org by 083, and
-- these are columns on a table that is already covered.

COMMIT;

NOTIFY pgrst, 'reload schema';
