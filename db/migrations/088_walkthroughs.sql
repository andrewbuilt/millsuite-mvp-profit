-- ============================================================================
-- 088 — guided walkthroughs: per-user tour progress + practice projects
-- ============================================================================
-- Two additive nullable-safe columns. No data is rewritten, nothing is dropped.
--
-- users.walkthrough_state — per-user progress for the guided tours, keyed by
-- tour id:
--   {
--     "welcome":   { "step": 3, "offered_at": "...", "dismissed_at": "..." },
--     "first-job": { "step": 8, "completed_at": "..." }
--   }
-- jsonb rather than a table because it is read exactly once per session (with
-- the user's own row) and written only by the tour engine. There is no query
-- that wants to ask a question ACROSS users' progress.
--
-- NOTE ON WRITES — read this before adding a browser-side write:
-- `users` has RLS enabled (083) with exactly two policies (084/085):
--   users_select_self    SELECT   auth_user_id = auth.uid()
--   users_delete_own_org DELETE   org_id = current_org_id()
-- There is NO UPDATE policy, so an UPDATE from the browser matches zero rows
-- and PostgREST reports `{ error: null }` — success-shaped silence, the same
-- trap `lib/org-write.ts` exists to catch on `orgs`. That is why walkthrough
-- state (and onboarding state, which had been quietly failing since 083 landed
-- on prod 2026-08-06) is written through /api/me/progress with the service
-- role instead. Do not add a `supabase.from('users').update(...)` in client
-- code; it will look like it worked.
--
-- projects.practice_at — non-null marks a throwaway project created by the
-- "Price your first job" walkthrough. Modelled on `imported_at` (080): a
-- nullable timestamp doubles as "when", and one column drives both the badge
-- and the exclusion filters (reports, capacity, dashboard outlook) so practice
-- numbers never pollute real ones.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS walkthrough_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS practice_at timestamptz NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
