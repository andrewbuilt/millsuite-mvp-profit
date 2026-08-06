-- ============================================================================
-- 082 — internal / founder plan (fix list 2, item 3)
-- ============================================================================
-- `orgs.plan = 'internal'` marks an org that isn't a customer: Andrew's own
-- shop, plus any future demo or partner account. The app grants it every
-- feature, unlimited seats and unlimited usage, and hides billing entirely.
-- See lib/feature-flags.ts (INTERNAL_PLAN / isInternalPlan) for the gates.
--
-- No schema change: `orgs.plan` is a plain text column with no CHECK
-- constraint (only plan_status is constrained, see 050/056), and 'internal'
-- is deliberately NOT a member of PLANS, so `validatePlan` rejects it at
-- signup and checkout. It can only be granted here, in SQL.
--
-- ORDER MATTERS: deploy the code BEFORE running this. Older builds run
-- 'internal' through normalizePlan(), which falls back to 'starter' — so
-- flipping the row first would briefly DOWNGRADE the org.
--
-- To grant it to another org later:
--   UPDATE public.orgs SET plan = 'internal' WHERE slug = '<slug>';
-- To revoke, set the plan back to a real tier ('starter' | 'pro' | 'pro-ai').
--
-- NOTE: this does not touch Stripe. An org that already has a live
-- subscription keeps being billed until it's cancelled in the Stripe
-- dashboard — the plan value only controls what the app does.
-- ============================================================================

BEGIN;

UPDATE public.orgs
SET plan = 'internal'
WHERE slug = 'built'
  AND plan IS DISTINCT FROM 'internal';

NOTIFY pgrst, 'reload schema';

COMMIT;
