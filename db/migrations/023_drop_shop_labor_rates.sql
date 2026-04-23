-- Migration 023 - Drop shop_labor_rates table, Phase 12 item 12 PR3.
-- Labor $ is now hours × orgs.shop_rate; the per-department rate table
-- has no remaining readers. Runs after PR3 code merge so app code is
-- already routed through orgs.shop_rate.
--
-- Safe to run: every app-code reader of shop_labor_rates is removed in
-- the same PR. Historical suggestions payloads referenced the table in
-- comment strings only, not in queries.
--
-- Irreversible in the strict sense — data is lost. Users who had
-- populated per-dept rates lose them; the shop rate walkthrough
-- re-derives a single blended rate on next onboarding open.
--
-- Idempotent.

BEGIN;

DROP TABLE IF EXISTS public.shop_labor_rates;

COMMIT;

-- DOWN migration reference:
--   Recreate from migration 006 if needed. The table had:
--     id uuid pk, org_id uuid, dept text, rate_per_hour numeric,
--     created_at timestamptz, updated_at timestamptz,
--     unique(org_id, dept).
