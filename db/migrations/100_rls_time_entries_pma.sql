-- ============================================================================
-- 100 — RLS for time_entries + project_month_allocations
-- ============================================================================
-- FOUND 2026-09-12 by `node scripts/rls-audit.mjs`, which exits 1:
--
--   ❌ READABLE BY ANYONE WITH THE PUBLIC KEY
--      time_entries                      1 rows · 12 cols
--      project_month_allocations        13 rows · 13 cols
--
-- The anon key ships in the browser bundle, so "anyone with the public key"
-- means anyone, with no login, across EVERY org. `time_entries` carries who
-- worked, on what job, for how long, with free-text notes. PMA carries which
-- projects a shop has booked into which months and the hours behind them —
-- i.e. a competitor's pipeline.
--
-- ⛔ WHY 083 MISSED THEM, AND THE LESSON. 083 locked down every table the
-- audit flagged at the time. These two were not flagged because they were
-- EMPTY, and the audit reports an empty table as "skipped — no signal either
-- way". They filled up later (native time tracking, then the capacity board)
-- and silently became readable. **An empty table passing the audit is not a
-- pass; it's an absence of evidence.** The same caveat is already written
-- against `project_payments` in STATE — it was real, twice.
--
-- Both tables have a NOT NULL `org_id`, so the standard shape applies with no
-- parent-scoping games. Matches `project_payments` (099), `tasks` (093) and
-- `projects` (083).
--
-- ⚠️ WHAT THIS DOES NOT DO: within an org, any authenticated user can still
-- read the org's time entries. That's deliberate — /time is a manager view
-- over everyone, and narrowing SELECT by role would break it. The change here
-- is tenant isolation, not intra-org privacy.
--
-- ✅ SAFE FOR EVERY CALLER — checked before writing this, not assumed:
--   • Server routes that touch these tables (shop-report, weekly-snapshot,
--     projects/[id]/rollup via lib/project-rollup, project-outcome,
--     guides/path) ALL use `supabaseAdmin` — the service role bypasses RLS.
--   • Browser writes all carry org_id explicitly (time/page.tsx,
--     time/mobile/page.tsx, capacity/page.tsx), so WITH CHECK passes.
--   • Workers (role 'member') clock in from /me and /time/mobile with a real
--     session. `current_org_id()` is SECURITY DEFINER, so it reads `users`
--     from inside a policy despite `users_select_self` (084).
--   • No unauthenticated page reads either table.
--
-- ROLLBACK (restores the previous, wide-open behaviour):
--   ALTER TABLE public.time_entries              DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.project_month_allocations DISABLE ROW LEVEL SECURITY;
--
-- VERIFY: `node scripts/rls-audit.mjs` must exit 0 and list both tables under
-- ✅ BLOCKED with a nonzero row count. A zero count means "empty", which is
-- exactly the non-signal that let this happen.
-- ============================================================================

BEGIN;

-- time_entries ---------------------------------------------------------------

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS time_entries_own_org ON public.time_entries;
CREATE POLICY time_entries_own_org ON public.time_entries
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- project_month_allocations --------------------------------------------------

ALTER TABLE public.project_month_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_month_allocations_own_org ON public.project_month_allocations;
CREATE POLICY project_month_allocations_own_org ON public.project_month_allocations
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
