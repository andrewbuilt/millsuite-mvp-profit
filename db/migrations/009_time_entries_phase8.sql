-- ============================================================================
-- 009_time_entries_phase8.sql — Phase 8: native time tracking against depts
-- ============================================================================
-- Two things here:
--
-- 1. Bring the time_entries table into db/migrations/ as a first-class
--    migration. Until now it only lived in docs/migration.sql. The CREATE
--    below is idempotent (IF NOT EXISTS) so it's safe on environments that
--    already provisioned it from the docs file.
--
-- 2. Add department_id so a crew clock-in can record *which* department the
--    span counts against. The schedule operates in department_allocations,
--    and Phase 8 wants actuals-vs-estimated comparisons per department —
--    which is only possible if each clock-in knows its department.
--
-- department_id is nullable: historical entries predate this column, and
-- the mobile timer can still be saved without a department (it just won't
-- contribute to per-dept actuals).
-- ============================================================================

-- Guard: create time_entries if it doesn't exist yet (aligns dev envs with
-- production schemas that were seeded from docs/migration.sql). Follows the
-- rest of the millsuite migrations' soft-FK convention: org_id / user_id are
-- plain uuids (no FK), project_id / subproject_id / department_id use real
-- FKs because those tables are first-class scoping entities in the app.
CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id UUID REFERENCES subprojects(id) ON DELETE SET NULL,
  employee_type TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_minutes INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_org ON time_entries(org_id);

-- Phase 8 additions.
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_subproject
  ON time_entries(subproject_id) WHERE subproject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_department
  ON time_entries(department_id) WHERE department_id IS NOT NULL;

-- Composite (subproject, department) speeds up actuals-by-sub-per-dept reads,
-- which both /rollup and the subproject editor hit per page load.
CREATE INDEX IF NOT EXISTS idx_time_entries_sub_dept
  ON time_entries(subproject_id, department_id)
  WHERE subproject_id IS NOT NULL AND department_id IS NOT NULL;

COMMENT ON COLUMN time_entries.department_id IS
  'Which department this time span counts against. Nullable — pre-Phase-8 entries + ad-hoc logs without a dept are still valid. Set by the /time clock-in UI.';
