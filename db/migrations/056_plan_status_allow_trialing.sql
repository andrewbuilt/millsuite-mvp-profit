-- ============================================================================
-- 056 — Allow plan_status = 'trialing' (hotfix for migration 055)
-- ============================================================================
-- 055 introduced the no-card base-tier trial, which sets
-- orgs.plan_status = 'trialing'. But the CHECK constraint added in 050
-- (orgs_plan_status_check) still only allowed
-- pending/active/past_due/canceled/incomplete — so create_org_with_owner()
-- failed with "violates check constraint orgs_plan_status_check" and base-
-- tier signup broke. This widens the constraint to include 'trialing'.
--
-- Run this against prod ASAP — base-tier signup is broken until it lands.
--
-- Rollback (only if no rows use 'trialing'):
--   ALTER TABLE public.orgs DROP CONSTRAINT IF EXISTS orgs_plan_status_check;
--   ALTER TABLE public.orgs ADD CONSTRAINT orgs_plan_status_check
--     CHECK (plan_status IN ('pending','active','past_due','canceled','incomplete'));
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs DROP CONSTRAINT IF EXISTS orgs_plan_status_check;

ALTER TABLE public.orgs
  ADD CONSTRAINT orgs_plan_status_check
  CHECK (plan_status IN ('pending','trialing','active','past_due','canceled','incomplete'));

NOTIFY pgrst, 'reload schema';

COMMIT;
