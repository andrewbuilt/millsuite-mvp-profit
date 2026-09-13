-- ============================================================================
-- 104 — RLS for department_allocations
-- ============================================================================
-- ⛔ READABLE BY ANYONE WITH THE PUBLIC KEY, RIGHT NOW. 40 rows, 12 columns,
-- no login, every org. It holds the shop's production plan: which subproject
-- is allocated to which department, estimated and actual hours, scheduled
-- dates and crew sizes. Demonstrated with an anon-key read, not inferred.
--
-- ── HOW IT SURVIVED THREE PRIOR AUDITS, WHICH IS THE REAL LESSON ────────────
-- `scripts/rls-audit.mjs` checks a HAND-MAINTAINED list of table names, and
-- `department_allocations` was never on it. It takes no arguments either —
-- `node rls-audit.mjs some_table` silently ignores them — so the table was
-- never checked, and not being checked looked exactly like passing.
--
-- This is the THIRD time this shape has bitten: 083 locked down what the
-- audit flagged; 100 caught `time_entries` + `project_month_allocations`,
-- which had been skipped while empty; and now this one, which was never in
-- the list at all. Two different ways to be invisible, same outcome.
--
-- The audit now reads every `CREATE TABLE` out of db/migrations and REFUSES
-- to report a clean run while any of them is unlisted. That found 34 unaudited
-- tables in one go; this was the only one actually exposed. ⚠️ A table
-- created outside a migration would still be invisible — if that ever
-- happens, this check can't see it either.
--
-- `org_id` is present and populated on every row (verified against prod
-- before writing this), so the standard shape applies.
--
-- ⚠️ NOT IN THE 001 MIGRATION. `org_id` was added to this table out of band —
-- 001 defines 16 columns and prod has 12, including an `org_id` the file
-- never mentions. The app has always filtered on it (`/capacity`), so the
-- column is real; the migration history just doesn't describe it.
--
-- ROLLBACK:
--   ALTER TABLE public.department_allocations DISABLE ROW LEVEL SECURITY;
--
-- VERIFY: `node scripts/rls-audit.mjs` exits 0 and lists it under ✅ BLOCKED
-- with a NONZERO row count ("0 of 40"). A zero count means empty, which is
-- the non-signal that hid the last one.
-- ============================================================================

BEGIN;

ALTER TABLE public.department_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS department_allocations_own_org ON public.department_allocations;
CREATE POLICY department_allocations_own_org ON public.department_allocations
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
