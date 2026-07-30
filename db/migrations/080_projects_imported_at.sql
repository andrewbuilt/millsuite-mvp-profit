-- ============================================================================
-- 080 — projects.imported_at (Built-OS selective migration, 6c item 2)
-- ============================================================================
-- Imported jobs must be visibly flagged so they don't blend with work priced
-- natively in MillSuite (their estimates came from Built's rate book, not the
-- new composer). The migration script stamps this; the UI renders a gray
-- "IMPORTED" badge on project cards, the project detail header, and sales
-- kanban cards.
--
-- Nullable timestamp, not a boolean: it doubles as "when did this come over".
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS imported_at timestamptz NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
