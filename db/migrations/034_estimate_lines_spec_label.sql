-- ============================================================================
-- Migration 034 — estimate_lines.spec_label
-- ============================================================================
-- Lets a freeform line opt into the pre-prod approval flow.
--
-- Composer lines (product_key set) generate approval cards from their
-- product_slots — see proposeSlotsFromComposerLine in lib/approvals.ts.
-- Freeform lines (product_key NULL) had no equivalent: a "Custom doors"
-- line could be a real client decision, but it didn't surface anywhere
-- post-sale.
--
-- The fix is intentionally tiny: one optional column on estimate_lines.
-- When non-empty, the freeform line becomes one approval slot on
-- handoff (label = spec_label, material = line description). When NULL
-- it stays a back-of-house cost item with no client-facing decision.
--
-- Idempotent — column add is gated on IF NOT EXISTS so re-running on a
-- partially-applied state is a no-op.
-- ============================================================================

BEGIN;

ALTER TABLE public.estimate_lines
  ADD COLUMN IF NOT EXISTS spec_label text;

COMMIT;
