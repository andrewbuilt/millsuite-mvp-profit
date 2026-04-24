-- Migration 026 - drop retired Phase 11 onboarding tables.
-- Per BUILD-ORDER Phase 12 Task 17 + the handoff close-out sequence.
--
-- Phase 11's first-run wizard (business-card / past-estimate /
-- bank-statement / dept-rate sliders) was retired when the Phase 12
-- WelcomeOverlay + first-principles shop-rate walkthrough shipped.
-- The two wizard-state tables no longer have any readers in-repo after
-- Task 17 strips lib/onboarding.ts of the orphan helpers.
--
-- No RLS-policy cleanup needed - dropping the tables removes the
-- policies on them in cascade.
--
-- Irreversible: wizard progress rows and stashed baselines are
-- destroyed. Safe: nothing reads them; the confidence ramp (the one
-- live piece from Phase 11) rides on rate_book_items columns, not
-- these tables.
--
-- Idempotent.

BEGIN;

DROP TABLE IF EXISTS public.onboarding_stashed_baselines;
DROP TABLE IF EXISTS public.onboarding_progress;

COMMIT;

-- DOWN migration reference:
--   Recreate from db/migrations/012_onboarding_phase11.sql if needed.
--   Both tables are there in full.
