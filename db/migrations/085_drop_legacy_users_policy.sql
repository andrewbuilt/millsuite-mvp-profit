-- ============================================================================
-- 085 — drop the legacy "Users see own org data" policy (the real recursion)
-- ============================================================================
-- 083 enabled RLS on `users` and 084 replaced the policy it had added, yet the
-- recursion survived both. Reason: a THIRD policy was already on the table,
-- created by hand in the Supabase dashboard long ago (the spaces in its name
-- give it away — no migration in this repo creates it):
--
--   "Users see own org data" | FOR ALL | TO public
--   USING (org_id IN (SELECT users_1.org_id FROM users users_1
--                     WHERE users_1.auth_user_id = auth.uid()))
--
-- A policy ON users whose predicate SELECTS FROM users. Evaluating it re-enters
-- the same policy → "infinite recursion detected in policy for relation users".
--
-- It was invisible until now because `users` had RLS DISABLED: policies can
-- exist on a table indefinitely without being enforced, and nothing in the app
-- or the audit could observe them. 083 flipped RLS on and armed it.
--
-- LESSON for the rest of this work: enabling RLS on a table does not start from
-- a blank slate. Check pg_policies for what's already there BEFORE enabling:
--   SELECT tablename, policyname, permissive, cmd, roles::text, qual
--   FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;
-- This matters beyond the recursion: multiple PERMISSIVE policies combine with
-- OR, so a forgotten broad policy silently widens access rather than narrowing
-- it. The survey in the header of this file's companion check covers the other
-- seven tables 083 armed.
--
-- After this, `users` carries exactly two policies, neither self-referential:
--   users_select_self    SELECT authenticated  auth_user_id = auth.uid()
--   users_delete_own_org DELETE authenticated  org_id = current_org_id()
--
-- Rollback (restores the recursion — only useful to prove causation):
--   CREATE POLICY "Users see own org data" ON public.users FOR ALL TO public
--     USING (org_id IN (SELECT u.org_id FROM public.users u
--                       WHERE u.auth_user_id = auth.uid()));
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Users see own org data" ON public.users;

NOTIFY pgrst, 'reload schema';

COMMIT;
