-- ============================================================================
-- 063 — Built OS migration: id map + project archive (migration chunk 2)
-- ============================================================================
-- Supports the Built OS → MillSuite data migration script
-- (scripts/migrate-built/). Two additions:
--
--   1. migration_id_map — every migrated row records (entity, built_id) →
--      millsuite_id so the transfer is idempotent: a re-run upserts through
--      the map (updates the existing MillSuite row) instead of duplicating.
--
--   2. projects.built_archive (jsonb) — completed jobs come across as
--      read-only snapshots; the original Built OS spec_lines_json + frozen
--      source totals are stashed here so history is preserved without
--      re-modeling the estimate.
--
-- Writes to migration_id_map happen only via the service-role script (which
-- bypasses RLS); regular users get read-only, org-scoped access.
--
-- Idempotent (IF NOT EXISTS). Run against prod Supabase before running the
-- migration script's write phase.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.migration_id_map (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  entity       text NOT NULL,   -- 'client' | 'project' | 'subproject' | 'estimate_line' | 'milestone'
  built_id     text NOT NULL,   -- source primary key from Built OS (uuid as text)
  millsuite_id uuid NOT NULL,   -- the row created/updated in MillSuite
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity, built_id)
);

CREATE INDEX IF NOT EXISTS idx_migration_id_map_lookup
  ON public.migration_id_map(org_id, entity, built_id);

-- Snapshot archive for read-only completed jobs (migration chunk 5).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS built_archive jsonb;

ALTER TABLE public.migration_id_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS migration_id_map_select ON public.migration_id_map;
CREATE POLICY migration_id_map_select ON public.migration_id_map FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = migration_id_map.org_id AND u.auth_user_id = auth.uid()
  ));
-- No write policy: only the service-role migration script writes here.

NOTIFY pgrst, 'reload schema';

COMMIT;
