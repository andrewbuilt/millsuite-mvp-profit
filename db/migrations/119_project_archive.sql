-- ============================================================================
-- 119 — Project archive (scoped 2026-10-22)
-- ============================================================================
--   projects.archived_at — non-null = archived. Manual, for COMPLETED and LOST
--                          projects: they leave the kanban, /projects, pickers
--                          and the /pm cards, and live on Manage → Archive.
--                          DISPLAY ONLY — reports, sales intelligence, margins
--                          and history keep counting them. Unarchive clears it.
--
-- Read by lib/project-archive as a separate id set (never a column filter on
-- the main queries), so a database without this column degrades to "nothing
-- archived" instead of failing the page — the practice/temp lesson.
--
-- Idempotent. No RLS change (projects already under org policies, 083).
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

COMMENT ON COLUMN public.projects.archived_at IS
  'Non-null = archived (display only: off kanban, /projects, pickers, /pm; still in reports). See lib/project-archive. (119)';

CREATE INDEX IF NOT EXISTS projects_archived_at_idx
  ON public.projects (org_id)
  WHERE archived_at IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
