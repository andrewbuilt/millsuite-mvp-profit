-- ============================================================================
-- Migration 024 — RLS policies for rate_book_categories + rate_book_items
-- ============================================================================
-- Same situation migration 018 called out: these tables were created in 001
-- but never shipped RLS in the repo. The Supabase dashboard has RLS enabled
-- with a SELECT policy only, which is why reads work but INSERTs 403 with
--   "new row violates row-level security policy for table rate_book_categories"
-- when the base cabinet walkthrough tries to create a cabinet_style category
-- on first run for an org that hasn't been seeded yet.
--
-- seedStarterRateBook (lib/rate-book-seed.ts) has been silently failing the
-- same way — its .insert calls don't inspect the error, so orgs that never
-- had categories stayed never-having-categories, and the walkthrough became
-- the first code path that *does* check the error and surfaces the 403.
--
-- Policy model: authenticated role, scoped via EXISTS on the parent org row.
-- Matches 017 / 018 / 019 precedent. Tighten to membership-scoped RLS later
-- when cross-org sharing actually exists.
-- ============================================================================

BEGIN;

-- rate_book_categories --------------------------------------------------------

ALTER TABLE public.rate_book_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_book_categories_select_authenticated ON public.rate_book_categories;
DROP POLICY IF EXISTS rate_book_categories_insert_authenticated ON public.rate_book_categories;
DROP POLICY IF EXISTS rate_book_categories_update_authenticated ON public.rate_book_categories;
DROP POLICY IF EXISTS rate_book_categories_delete_authenticated ON public.rate_book_categories;

CREATE POLICY rate_book_categories_select_authenticated
  ON public.rate_book_categories FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_categories.org_id));

CREATE POLICY rate_book_categories_insert_authenticated
  ON public.rate_book_categories FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_categories.org_id));

CREATE POLICY rate_book_categories_update_authenticated
  ON public.rate_book_categories FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_categories.org_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_categories.org_id));

CREATE POLICY rate_book_categories_delete_authenticated
  ON public.rate_book_categories FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_categories.org_id));

-- rate_book_items -------------------------------------------------------------
-- Covered here too so the walkthrough's follow-on INSERT of the "Base cabinet"
-- row can't 403 right after we unblock categories. Same authenticated-on-org
-- pattern — items also carry org_id directly.

ALTER TABLE public.rate_book_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_book_items_select_authenticated ON public.rate_book_items;
DROP POLICY IF EXISTS rate_book_items_insert_authenticated ON public.rate_book_items;
DROP POLICY IF EXISTS rate_book_items_update_authenticated ON public.rate_book_items;
DROP POLICY IF EXISTS rate_book_items_delete_authenticated ON public.rate_book_items;

CREATE POLICY rate_book_items_select_authenticated
  ON public.rate_book_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_items.org_id));

CREATE POLICY rate_book_items_insert_authenticated
  ON public.rate_book_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_items.org_id));

CREATE POLICY rate_book_items_update_authenticated
  ON public.rate_book_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_items.org_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_items.org_id));

CREATE POLICY rate_book_items_delete_authenticated
  ON public.rate_book_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = rate_book_items.org_id));

COMMIT;
