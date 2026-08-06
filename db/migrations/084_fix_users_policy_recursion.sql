-- ============================================================================
-- 084 — HOTFIX: infinite recursion in the users policy from 083
-- ============================================================================
-- 083 gave `users` this policy:
--     USING (org_id = public.current_org_id())
-- and current_org_id() is `SELECT org_id FROM public.users WHERE
-- auth_user_id = auth.uid()`.
--
-- Evaluating the policy runs the function, the function reads `users`, reading
-- `users` evaluates the policy… Postgres catches the loop and every query
-- against users — and against every table whose policy calls the function
-- (orgs, projects, subprojects, departments, shop_rate_settings,
-- department_members) — fails with:
--     infinite recursion detected in policy for relation "users"
--
-- SECURITY DEFINER was supposed to prevent this by running the function as its
-- owner, but bypassing RLS that way needs the owner to own the table or hold
-- BYPASSRLS, and on this database it evidently doesn't. So don't rely on it:
-- make the users SELECT policy self-referential-free instead.
--
-- With the policy below, the function's own read is served by a predicate that
-- does NOT call the function, so the loop can't form. Every other table's
-- policy keeps calling current_org_id() and now resolves normally.
--
-- Trade-off: from the browser you can only SELECT your OWN users row, not the
-- rest of the org's. The two places that counted org users for a seat display
-- move to /api/org/seats (service role). Everything else already used the
-- service role.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS users_select_own_org ON public.users;
DROP POLICY IF EXISTS users_select_self ON public.users;

-- Self row only. No function call → no recursion. This is what unblocks
-- current_org_id(), and therefore every other policy in 083.
CREATE POLICY users_select_self ON public.users
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- DELETE stays org-scoped: /team removes a login's row directly. Safe now —
-- the function's internal read is served by the self policy above.
DROP POLICY IF EXISTS users_delete_own_org ON public.users;
CREATE POLICY users_delete_own_org ON public.users
  FOR DELETE TO authenticated
  USING (org_id = public.current_org_id());

NOTIFY pgrst, 'reload schema';

COMMIT;
