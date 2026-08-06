-- ============================================================================
-- 086 — drop the duplicate legacy policies left over after 083–085
-- ============================================================================
-- Cleanup, not a fix. Verified against prod after 085: the app works and the
-- audit exits clean WITH these still in place. They're dropped because
-- duplicate policies on security tables are precisely what made 083 take four
-- attempts to land.
--
-- What these are: hand-made dashboard policies (spaces in the names) that
-- predate every migration in this repo. They sat dormant for as long as their
-- tables had RLS disabled, and 083 armed them. Each one says the same thing as
-- the `*_own_org` policy 083 added, in the older shape:
--
--   org_id IN (SELECT users.org_id FROM users WHERE users.auth_user_id = auth.uid())
--   vs.
--   org_id = public.current_org_id()          -- the function does that lookup
--
-- Why dropping them changes no access:
--   • Multiple PERMISSIVE policies combine with OR, and these are logically
--     identical to the ones that remain — the union is the same set of rows.
--   • They're TO public, which includes anon, but for an anonymous caller
--     auth.uid() is NULL, the subquery returns nothing, and `IN` is false. The
--     rls-audit script confirms empirically that anon reads nothing either way.
--
-- clients_all / contacts_all are the same story from the migration era rather
-- than the dashboard. NOTE: these two use the CORRECT user-scoped predicate,
-- not the no-op `EXISTS (SELECT 1 FROM orgs …)` that 033 records. Production
-- had already been fixed by hand and the migration files never caught up —
-- which is why 083's header overstates the exposure on those two tables.
--
-- After this, every table 083 touched carries exactly one policy set, all of
-- the form `org_id = current_org_id()`, and nothing on `users` reads `users`.
--
-- Rollback: recreate any of them from the definitions above; access is
-- unchanged either way, so there is nothing to restore in a hurry.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Users see own org"             ON public.orgs;
DROP POLICY IF EXISTS "Users see own org projects"    ON public.projects;
DROP POLICY IF EXISTS "Users see own org subprojects" ON public.subprojects;
DROP POLICY IF EXISTS "Users see own org shop rate"   ON public.shop_rate_settings;
DROP POLICY IF EXISTS clients_all                     ON public.clients;
DROP POLICY IF EXISTS contacts_all                    ON public.contacts;

NOTIFY pgrst, 'reload schema';

COMMIT;
