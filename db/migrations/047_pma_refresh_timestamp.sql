-- ============================================================================
-- 047 — project_month_allocations.hours_refreshed_at
-- ============================================================================
-- Stamps when an allocation's hours_allocated + department_hours were last
-- pulled from estimate_lines via loadProjectDeptHours. Surfaced in the
-- /capacity side pane as "Last refreshed: X" so an operator can tell a
-- frozen drop-time number from a freshly-resynced one. NULL on legacy
-- rows + on the initial drop (drop time IS the refresh).
-- ============================================================================

BEGIN;

ALTER TABLE public.project_month_allocations
  ADD COLUMN IF NOT EXISTS hours_refreshed_at timestamptz NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
