-- ============================================================================
-- Migration 032 — approval_items.revision counter
-- ============================================================================
-- Until now the "rev" badge on a spec card was derived from a count of
-- item_revisions rows with action='submitted'. That worked when the only
-- way to bump rev was to push a new sample, but the post-sale dogfood pass
-- introduces a second bump path: an approved change order that touches an
-- already-approved spec resets the spec to pending and bumps it to rev N+1.
-- The CO doesn't write a 'submitted' row, so the audit-count heuristic
-- under-reports. Storing the rev as a column makes the bump explicit, lets
-- the UI render it without a join, and keeps the audit trail in
-- item_revisions for history.
--
-- Default 1 covers everything that exists pre-migration; a "pending, never
-- sampled" slot still reads as rev 1, matching how the UI displayed it
-- before. Subsequent bumps come from the application.
-- ============================================================================

BEGIN;

ALTER TABLE public.approval_items
  ADD COLUMN IF NOT EXISTS revision int NOT NULL DEFAULT 1;

COMMIT;
