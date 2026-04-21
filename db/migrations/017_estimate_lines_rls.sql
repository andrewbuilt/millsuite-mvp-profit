-- ============================================================================
-- Migration 017 — RLS policies for estimate_lines + estimate_line_options
-- ============================================================================
-- The earlier migrations created these tables but never shipped RLS policies
-- in the repo (they were likely configured manually in the Supabase console,
-- and whatever was there is now rejecting both SELECT and INSERT — the
-- subproject editor and the pre-production page both 403 on load).
--
-- This migration sets them up idempotently. Model: any authenticated user can
-- read + write estimate_lines for subprojects whose parent project's org_id
-- matches a project they can see. For an MVP with no cross-org sharing the
-- simplest path is "authenticated role, subproject must exist" — matches
-- what migration 015 did for the parse-drawings bucket after the same
-- problem surfaced there.
-- ============================================================================

BEGIN;

-- estimate_lines --------------------------------------------------------------

ALTER TABLE estimate_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estimate_lines_select_own_org      ON estimate_lines;
DROP POLICY IF EXISTS estimate_lines_insert_own_org      ON estimate_lines;
DROP POLICY IF EXISTS estimate_lines_update_own_org      ON estimate_lines;
DROP POLICY IF EXISTS estimate_lines_delete_own_org      ON estimate_lines;
DROP POLICY IF EXISTS estimate_lines_select_authenticated ON estimate_lines;
DROP POLICY IF EXISTS estimate_lines_insert_authenticated ON estimate_lines;
DROP POLICY IF EXISTS estimate_lines_update_authenticated ON estimate_lines;
DROP POLICY IF EXISTS estimate_lines_delete_authenticated ON estimate_lines;

CREATE POLICY estimate_lines_select_authenticated
  ON estimate_lines
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM subprojects s WHERE s.id = estimate_lines.subproject_id)
  );

CREATE POLICY estimate_lines_insert_authenticated
  ON estimate_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM subprojects s WHERE s.id = estimate_lines.subproject_id)
  );

CREATE POLICY estimate_lines_update_authenticated
  ON estimate_lines
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM subprojects s WHERE s.id = estimate_lines.subproject_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM subprojects s WHERE s.id = estimate_lines.subproject_id)
  );

CREATE POLICY estimate_lines_delete_authenticated
  ON estimate_lines
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM subprojects s WHERE s.id = estimate_lines.subproject_id)
  );

-- estimate_line_options -------------------------------------------------------

ALTER TABLE estimate_line_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estimate_line_options_select_own_org      ON estimate_line_options;
DROP POLICY IF EXISTS estimate_line_options_insert_own_org      ON estimate_line_options;
DROP POLICY IF EXISTS estimate_line_options_update_own_org      ON estimate_line_options;
DROP POLICY IF EXISTS estimate_line_options_delete_own_org      ON estimate_line_options;
DROP POLICY IF EXISTS estimate_line_options_select_authenticated ON estimate_line_options;
DROP POLICY IF EXISTS estimate_line_options_insert_authenticated ON estimate_line_options;
DROP POLICY IF EXISTS estimate_line_options_update_authenticated ON estimate_line_options;
DROP POLICY IF EXISTS estimate_line_options_delete_authenticated ON estimate_line_options;

CREATE POLICY estimate_line_options_select_authenticated
  ON estimate_line_options
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM estimate_lines l WHERE l.id = estimate_line_options.estimate_line_id)
  );

CREATE POLICY estimate_line_options_insert_authenticated
  ON estimate_line_options
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM estimate_lines l WHERE l.id = estimate_line_options.estimate_line_id)
  );

CREATE POLICY estimate_line_options_update_authenticated
  ON estimate_line_options
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM estimate_lines l WHERE l.id = estimate_line_options.estimate_line_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM estimate_lines l WHERE l.id = estimate_line_options.estimate_line_id)
  );

CREATE POLICY estimate_line_options_delete_authenticated
  ON estimate_line_options
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM estimate_lines l WHERE l.id = estimate_line_options.estimate_line_id)
  );

COMMIT;
