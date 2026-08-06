-- ============================================================================
-- 083 — row-level security: real tenant isolation
-- ============================================================================
-- AUDIT (2026-08-04, run against prod with the public anon key + the migration
-- files). Three separate holes:
--
-- 1. NO RLS AT ALL — readable by anyone holding the anon key, which ships in
--    the browser bundle, with no login:
--      orgs (28 rows, 45 cols — incl. team_members jsonb with every
--            employee's name, email, phone and annual_comp, plus overhead,
--            shop rate and Stripe customer/subscription ids)
--      users (92 rows — every login's email, name, role, across all orgs)
--      projects (12), subprojects (59), departments (91),
--      department_members (87), shop_rate_settings (27),
--      subproject_approval_status (59, a view)
--
-- 2. NO-OP POLICIES — 16 policies on clients, contacts, rate_book_items and
--    rate_book_categories read:
--        EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = x.org_id)
--    That asserts the org ROW EXISTS, not that the caller belongs to it. Any
--    signed-in user from any shop passes it.
--
-- 3. INHERITED FROM AN UNPROTECTED PARENT — 23 policies on estimate_lines,
--    change_orders, approval_items, drawing_revisions, cash_flow_receivables
--    and project_documents scope through `projects` / `subprojects`, which
--    (per 1) have no RLS. So they're open to any authenticated user too.
--    These become correct automatically once the parents are locked down.
--
-- 70 policies on the newer tables (materials, door_types, custom_products,
-- cabinet_features, client_invoices, pto_*, capacity_overrides, …) already use
-- the right shape and are left alone.
--
-- THE FIX: one helper, `current_org_id()`, and org-scoped policies everywhere.
-- SECURITY DEFINER on the helper is required — `users` gets RLS below, and a
-- policy on users that had to read users would recurse.
--
-- ⚠️ THE ONE THING THAT CAN BREAK SIGN-IN: two UNAUTHENTICATED pages read
-- `orgs` by slug for branding — the vanity shop login (`/{slug}`,
-- components/shop-login.tsx) and the invite page (`/join/{slug}`). A visitor
-- has no session, so no row-level policy can serve them. They move to the
-- `org_public_by_slug()` function below, which returns ONLY name/slug/logo.
-- Deploy that app change together with this migration.
--
-- ROLLBACK (restores the previous, wide-open behaviour):
--   ALTER TABLE public.orgs               DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.users              DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.projects           DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.subprojects        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.departments        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.department_members DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.shop_rate_settings DISABLE ROW LEVEL SECURITY;
-- (The replaced policies in section 4 can be restored from 024/033.)
-- ============================================================================

BEGIN;

-- ── 1. Helpers ──────────────────────────────────────────────────────────────

-- The caller's org. SECURITY DEFINER so it can read `users` from inside a
-- policy ON `users` without recursing, and STABLE so the planner calls it once
-- per statement rather than per row.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT org_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_org_id() FROM public;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;

-- Public shop branding for the two pre-login pages. Returns exactly the three
-- fields those pages render — never comp, never Stripe ids — for ONE slug.
CREATE OR REPLACE FUNCTION public.org_public_by_slug(p_slug text)
RETURNS TABLE (name text, slug text, logo_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.name, o.slug, o.logo_url
  FROM public.orgs o
  WHERE o.slug = p_slug
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.org_public_by_slug(text) FROM public;
GRANT EXECUTE ON FUNCTION public.org_public_by_slug(text) TO anon, authenticated;

-- ── 2. Lock down the tables that had no RLS ─────────────────────────────────

-- orgs — SELECT + UPDATE only. Creation goes through create_org_with_owner()
-- (SECURITY DEFINER, so it bypasses this); nothing may delete an org.
ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orgs_select_own ON public.orgs;
CREATE POLICY orgs_select_own ON public.orgs
  FOR SELECT TO authenticated
  USING (id = public.current_org_id());
DROP POLICY IF EXISTS orgs_update_own ON public.orgs;
CREATE POLICY orgs_update_own ON public.orgs
  FOR UPDATE TO authenticated
  USING (id = public.current_org_id())
  WITH CHECK (id = public.current_org_id());

-- users — SELECT for the roster, DELETE because /team removes a login's row
-- directly. Creation + role changes go through /api/admin/users on the
-- service-role client.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_own_org ON public.users;
CREATE POLICY users_select_own_org ON public.users
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());
DROP POLICY IF EXISTS users_delete_own_org ON public.users;
CREATE POLICY users_delete_own_org ON public.users
  FOR DELETE TO authenticated
  USING (org_id = public.current_org_id());

-- projects / subprojects / departments — full CRUD from the app, all scoped.
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_own_org ON public.projects;
CREATE POLICY projects_own_org ON public.projects
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

ALTER TABLE public.subprojects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subprojects_own_org ON public.subprojects;
CREATE POLICY subprojects_own_org ON public.subprojects
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departments_own_org ON public.departments;
CREATE POLICY departments_own_org ON public.departments
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- department_members — the legacy dept↔login join table. /team deletes from it
-- when a login is removed, so it needs write access too.
ALTER TABLE public.department_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS department_members_own_org ON public.department_members;
CREATE POLICY department_members_own_org ON public.department_members
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- shop_rate_settings — read-only from the browser today.
ALTER TABLE public.shop_rate_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_rate_settings_own_org ON public.shop_rate_settings;
CREATE POLICY shop_rate_settings_own_org ON public.shop_rate_settings
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ── 3. The approval-status view ─────────────────────────────────────────────
-- A view runs with its OWNER's rights, so it would keep bypassing the policies
-- on the tables underneath. security_invoker makes it run as the caller.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'subproject_approval_status'
      AND c.relkind IN ('v', 'm')
  ) THEN
    EXECUTE 'ALTER VIEW public.subproject_approval_status SET (security_invoker = true)';
  END IF;
END $$;

-- ── 4. Replace the no-op policies ───────────────────────────────────────────
-- Same four tables, same operations — only the predicate changes, from
-- "an org row with this id exists" to "this is MY org".

-- clients
DROP POLICY IF EXISTS clients_select_authenticated ON public.clients;
DROP POLICY IF EXISTS clients_insert_authenticated ON public.clients;
DROP POLICY IF EXISTS clients_update_authenticated ON public.clients;
DROP POLICY IF EXISTS clients_delete_authenticated ON public.clients;
DROP POLICY IF EXISTS clients_own_org ON public.clients;
CREATE POLICY clients_own_org ON public.clients
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- contacts
DROP POLICY IF EXISTS contacts_select_authenticated ON public.contacts;
DROP POLICY IF EXISTS contacts_insert_authenticated ON public.contacts;
DROP POLICY IF EXISTS contacts_update_authenticated ON public.contacts;
DROP POLICY IF EXISTS contacts_delete_authenticated ON public.contacts;
DROP POLICY IF EXISTS contacts_own_org ON public.contacts;
CREATE POLICY contacts_own_org ON public.contacts
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- rate_book_categories
DROP POLICY IF EXISTS rate_book_categories_select_authenticated ON public.rate_book_categories;
DROP POLICY IF EXISTS rate_book_categories_insert_authenticated ON public.rate_book_categories;
DROP POLICY IF EXISTS rate_book_categories_update_authenticated ON public.rate_book_categories;
DROP POLICY IF EXISTS rate_book_categories_delete_authenticated ON public.rate_book_categories;
DROP POLICY IF EXISTS rate_book_categories_own_org ON public.rate_book_categories;
CREATE POLICY rate_book_categories_own_org ON public.rate_book_categories
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- rate_book_items
DROP POLICY IF EXISTS rate_book_items_select_authenticated ON public.rate_book_items;
DROP POLICY IF EXISTS rate_book_items_insert_authenticated ON public.rate_book_items;
DROP POLICY IF EXISTS rate_book_items_update_authenticated ON public.rate_book_items;
DROP POLICY IF EXISTS rate_book_items_delete_authenticated ON public.rate_book_items;
DROP POLICY IF EXISTS rate_book_items_own_org ON public.rate_book_items;
CREATE POLICY rate_book_items_own_org ON public.rate_book_items
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

NOTIFY pgrst, 'reload schema';

COMMIT;
