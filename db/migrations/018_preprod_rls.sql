-- ============================================================================
-- Migration 018 — RLS policies for preprod tables
-- ============================================================================
-- Same pattern as 017 (estimate_lines). 002 created these tables but never
-- shipped RLS in the repo; the dashboard-configured policies currently reject
-- INSERT / SELECT on change_orders and approval_items, so the pre-production
-- page 403s when the user tries to add a CO or a custom approval slot.
--
-- Model: authenticated role, scoped via EXISTS against the parent row. Matches
-- the 015 / 017 precedent. Tighten to org-scoped RLS later when cross-org
-- sharing actually exists.
-- ============================================================================

BEGIN;

-- Helper — use the same "drop any prior policy, recreate" shape per table so
-- re-runs are always clean even if a prior attempt left a partial state.

-- change_orders ---------------------------------------------------------------

ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS change_orders_select_authenticated ON change_orders;
DROP POLICY IF EXISTS change_orders_insert_authenticated ON change_orders;
DROP POLICY IF EXISTS change_orders_update_authenticated ON change_orders;
DROP POLICY IF EXISTS change_orders_delete_authenticated ON change_orders;

CREATE POLICY change_orders_select_authenticated
  ON change_orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = change_orders.project_id));

CREATE POLICY change_orders_insert_authenticated
  ON change_orders FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = change_orders.project_id));

CREATE POLICY change_orders_update_authenticated
  ON change_orders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = change_orders.project_id))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = change_orders.project_id));

CREATE POLICY change_orders_delete_authenticated
  ON change_orders FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = change_orders.project_id));

-- approval_items --------------------------------------------------------------

ALTER TABLE approval_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_items_select_authenticated ON approval_items;
DROP POLICY IF EXISTS approval_items_insert_authenticated ON approval_items;
DROP POLICY IF EXISTS approval_items_update_authenticated ON approval_items;
DROP POLICY IF EXISTS approval_items_delete_authenticated ON approval_items;

CREATE POLICY approval_items_select_authenticated
  ON approval_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = approval_items.subproject_id));

CREATE POLICY approval_items_insert_authenticated
  ON approval_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = approval_items.subproject_id));

CREATE POLICY approval_items_update_authenticated
  ON approval_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = approval_items.subproject_id))
  WITH CHECK (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = approval_items.subproject_id));

CREATE POLICY approval_items_delete_authenticated
  ON approval_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = approval_items.subproject_id));

-- item_revisions --------------------------------------------------------------

ALTER TABLE item_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_revisions_select_authenticated ON item_revisions;
DROP POLICY IF EXISTS item_revisions_insert_authenticated ON item_revisions;
DROP POLICY IF EXISTS item_revisions_update_authenticated ON item_revisions;
DROP POLICY IF EXISTS item_revisions_delete_authenticated ON item_revisions;

CREATE POLICY item_revisions_select_authenticated
  ON item_revisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM approval_items a WHERE a.id = item_revisions.approval_item_id));

CREATE POLICY item_revisions_insert_authenticated
  ON item_revisions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM approval_items a WHERE a.id = item_revisions.approval_item_id));

CREATE POLICY item_revisions_update_authenticated
  ON item_revisions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM approval_items a WHERE a.id = item_revisions.approval_item_id))
  WITH CHECK (EXISTS (SELECT 1 FROM approval_items a WHERE a.id = item_revisions.approval_item_id));

CREATE POLICY item_revisions_delete_authenticated
  ON item_revisions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM approval_items a WHERE a.id = item_revisions.approval_item_id));

-- drawing_revisions -----------------------------------------------------------

ALTER TABLE drawing_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drawing_revisions_select_authenticated ON drawing_revisions;
DROP POLICY IF EXISTS drawing_revisions_insert_authenticated ON drawing_revisions;
DROP POLICY IF EXISTS drawing_revisions_update_authenticated ON drawing_revisions;
DROP POLICY IF EXISTS drawing_revisions_delete_authenticated ON drawing_revisions;

CREATE POLICY drawing_revisions_select_authenticated
  ON drawing_revisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = drawing_revisions.subproject_id));

CREATE POLICY drawing_revisions_insert_authenticated
  ON drawing_revisions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = drawing_revisions.subproject_id));

CREATE POLICY drawing_revisions_update_authenticated
  ON drawing_revisions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = drawing_revisions.subproject_id))
  WITH CHECK (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = drawing_revisions.subproject_id));

CREATE POLICY drawing_revisions_delete_authenticated
  ON drawing_revisions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM subprojects s WHERE s.id = drawing_revisions.subproject_id));

COMMIT;
