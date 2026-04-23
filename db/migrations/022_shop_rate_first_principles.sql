-- Migration 022 - Shop rate first-principles inputs, Phase 12 item 12.
-- Supersedes per-department shop rate flow from item 3. Adds three jsonb
-- columns on orgs to persist the inputs the new onboarding walkthrough
-- captures: overhead, team, billable hours. Compute happens in app code.
--
-- Why jsonb, not child tables:
--   V1 shape is a settings form. 9 overhead rows, under 20 team rows, no
--   cross-org aggregation, no referential integrity needed from other
--   tables. Whole-form saves, not per-row. RLS inherits from orgs, no
--   new policies. If V2 needs FKs from time_entries to team_members, we
--   migrate jsonb into tables then with real usage signal.
--
-- Column shapes:
--   orgs.overhead_inputs        jsonb, map of category to amount and period
--   orgs.team_members           jsonb, list of id name and annual_comp
--   orgs.billable_hours_inputs  jsonb, hrs_per_week weeks_per_year utilization_pct
--
-- All three default NULL. Walkthrough re-enters at screen 1 if any is null.
-- Idempotent.

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS overhead_inputs        jsonb NULL,
  ADD COLUMN IF NOT EXISTS team_members           jsonb NULL,
  ADD COLUMN IF NOT EXISTS billable_hours_inputs  jsonb NULL;

COMMIT;

-- DOWN migration reference:
--   BEGIN;
--   ALTER TABLE public.orgs
--     DROP COLUMN IF EXISTS overhead_inputs,
--     DROP COLUMN IF EXISTS team_members,
--     DROP COLUMN IF EXISTS billable_hours_inputs;
--   COMMIT;
