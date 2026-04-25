-- ============================================================================
-- Migration 033 — RLS policies for clients + contacts
-- ============================================================================
-- Same situation 018 / 024 / 031 documented for the other tables created in
-- migration 001 — clients + contacts ship with org_id columns but no RLS.
-- The dashboard cleanup pass (post-sale-2) lights up the first user-facing
-- writes to clients (project-detail Client picker + "+ Add new client"
-- inline form), which means RLS now matters in the live app.
--
-- Pattern: authenticated role, scoped via EXISTS on the parent org row,
-- mirroring 024 + 031. Tighten to membership-scoped RLS later when
-- cross-org sharing actually exists.
-- ============================================================================

BEGIN;

-- clients ---------------------------------------------------------------------

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_select_authenticated ON public.clients;
DROP POLICY IF EXISTS clients_insert_authenticated ON public.clients;
DROP POLICY IF EXISTS clients_update_authenticated ON public.clients;
DROP POLICY IF EXISTS clients_delete_authenticated ON public.clients;

CREATE POLICY clients_select_authenticated
  ON public.clients FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = clients.org_id));

CREATE POLICY clients_insert_authenticated
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = clients.org_id));

CREATE POLICY clients_update_authenticated
  ON public.clients FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = clients.org_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = clients.org_id));

CREATE POLICY clients_delete_authenticated
  ON public.clients FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = clients.org_id));

-- contacts --------------------------------------------------------------------
-- Covered alongside clients so the inline Add-Client form can attach a
-- primary contact without 403'ing on the contacts insert.

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_select_authenticated ON public.contacts;
DROP POLICY IF EXISTS contacts_insert_authenticated ON public.contacts;
DROP POLICY IF EXISTS contacts_update_authenticated ON public.contacts;
DROP POLICY IF EXISTS contacts_delete_authenticated ON public.contacts;

CREATE POLICY contacts_select_authenticated
  ON public.contacts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = contacts.org_id));

CREATE POLICY contacts_insert_authenticated
  ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = contacts.org_id));

CREATE POLICY contacts_update_authenticated
  ON public.contacts FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = contacts.org_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = contacts.org_id));

CREATE POLICY contacts_delete_authenticated
  ON public.contacts FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = contacts.org_id));

COMMIT;
