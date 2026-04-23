-- ============================================================================
-- Migration 021 — subproject install prefill (Phase 12 item 9)
-- ============================================================================
-- Per BUILD-ORDER Phase 12 item 9 + specs/add-line-composer/README.md
-- ("Install — subproject-level prefill, not a line item").
--
-- Three nullable columns on subprojects. Compute at read time:
--   guys × days × 8 (hrs/day) × shop_labor_rates.install × (1 + complexity%)
--
-- NULL = "not yet configured" — composer shows 0 inputs and install cost
-- of $0; once the user fills them in the cost flows into the subproject
-- total. Existing rows default to NULL (no install cost until set).
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.subprojects
  ADD COLUMN IF NOT EXISTS install_guys           integer NULL,
  ADD COLUMN IF NOT EXISTS install_days           numeric NULL,
  ADD COLUMN IF NOT EXISTS install_complexity_pct numeric NULL;

-- Sanity check constraints. Drop-and-recreate so re-runs are idempotent.
ALTER TABLE public.subprojects
  DROP CONSTRAINT IF EXISTS subprojects_install_guys_nonneg;
ALTER TABLE public.subprojects
  ADD CONSTRAINT subprojects_install_guys_nonneg
    CHECK (install_guys IS NULL OR install_guys >= 0);

ALTER TABLE public.subprojects
  DROP CONSTRAINT IF EXISTS subprojects_install_days_nonneg;
ALTER TABLE public.subprojects
  ADD CONSTRAINT subprojects_install_days_nonneg
    CHECK (install_days IS NULL OR install_days >= 0);

ALTER TABLE public.subprojects
  DROP CONSTRAINT IF EXISTS subprojects_install_complexity_pct_bounds;
ALTER TABLE public.subprojects
  ADD CONSTRAINT subprojects_install_complexity_pct_bounds
    CHECK (
      install_complexity_pct IS NULL
      OR (install_complexity_pct >= 0 AND install_complexity_pct <= 200)
    );

COMMIT;
