-- Migration 030 - drop the per-subproject profit_margin_pct override.
-- Per the pricing-architecture cleanup spec.
--
-- Margin is a project-level concept (projects.target_margin_pct, with
-- orgs.profit_margin_pct as the org default). The
-- subprojects.profit_margin_pct column was created earlier as a per-sub
-- override but it shouldn't exist - applying it produced double-markup
-- (subproject rollup applied per-sub margin, project rollup re-applied
-- project margin on top). Single source of truth: the project's
-- target_margin_pct, applied exactly once at the project total.
--
-- Code that previously read sub.profit_margin_pct moves to the project
-- target. Subproject rollups now run at COST (profitMarginPct = 0).
--
-- subprojects.consumable_markup_pct stays for now - readers exist that
-- would need rework. Follow-up migration will drop it once readers
-- collapse to org-only.
--
-- Idempotent.

BEGIN;

ALTER TABLE public.subprojects
  DROP COLUMN IF EXISTS profit_margin_pct;

COMMIT;

-- DOWN reference:
--   BEGIN;
--   ALTER TABLE public.subprojects
--     ADD COLUMN profit_margin_pct numeric NULL;
--   COMMIT;
--
--   No data restoration possible; per-sub overrides were rare.
