-- ============================================================================
-- 134 — tasks.description (2026-11-12, Andrew)
-- ============================================================================
-- Free-text detail under the title, edited in the task modal above
-- "Needed by". Null = none. Idempotent.
-- ============================================================================

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS description text;

NOTIFY pgrst, 'reload schema';
