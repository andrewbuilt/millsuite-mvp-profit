-- Migration 027 - per-project target margin override.
-- Per Phase 12 dogfood-2 Issue 12.
--
-- Adds projects.target_margin_pct so estimators can pin a project to a
-- specific markup target instead of inheriting the org default
-- (orgs.profit_margin_pct). NULL = inherit; non-NULL = pin.
--
-- The constraint allows 0..99. 100 would be infinite markup (price
-- equals cost / 0); we never let it go that high. Org-default fallback
-- and the front-end clamp mirror this range.
--
-- Idempotent.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS target_margin_pct numeric NULL;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_target_margin_valid;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_target_margin_valid
    CHECK (target_margin_pct IS NULL OR (target_margin_pct >= 0 AND target_margin_pct < 100));

COMMIT;

-- DOWN migration reference:
--   BEGIN;
--   ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_target_margin_valid;
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS target_margin_pct;
--   COMMIT;
