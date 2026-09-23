-- ============================================================================
-- 115 — payments visibility allowlist  (Andrew: "only him, Kaylin and Matt")
-- ============================================================================
-- Who can see MONEY MOVEMENT — the payments board, the dashboard cash cards,
-- draw schedules, the payment ledger. A jsonb array of LOGIN ids
-- (users.id::text) on the org, plus RLS so it's real, not cosmetic: an
-- unlisted manager's direct query returns zero rows (the 087 owner-only-comp
-- precedent — the database refuses, not just the UI).
--
-- THE RULES (decided with Andrew, 2026-09-23):
--   · OWNER ALWAYS SEES, regardless of the list — you cannot lock yourself out.
--   · NULL list = not configured = everyone in the org sees (a brand-new org
--     must work on day one; the SEED below configures existing orgs).
--   · The list holds LOGIN ids, because RLS can only know auth.uid() → users.
--     The Settings picker maps roster names to their linked logins.
--   · Contract totals STAY VISIBLE (his explicit call): `projects.bid_total`
--     and `invoices` are deliberately NOT gated — the project page keeps its
--     contract figure and the deposit/readiness gate keeps working for
--     everyone. What locks is payment MOVEMENT: `project_payments` (the
--     ledger) and `cash_flow_receivables` (draws/milestones).
--
-- SEED: every org's list starts as its owner + current admins — behaviour is
-- unchanged on day one for everyone currently able to see /payments; Andrew
-- then trims the list to the three of them in Settings.
--
-- ⚠️ SIDE EFFECT, DELIBERATE: this REPLACES migration 031's receivables
-- policies, which never correlated with auth.uid() at all — any authenticated
-- user of any org passed the EXISTS. The new policies pin the caller's org
-- (current_org_id, the 083 mechanism) AND the allowlist.
--
-- Service-role paths (QB watcher, PDF routes) bypass RLS and are unaffected.
--
-- Rollback: restore 031's policies + 099's project_payments_own_org, then
--   ALTER TABLE public.orgs DROP COLUMN IF EXISTS payments_visible_to;
--   DROP FUNCTION IF EXISTS public.can_see_payments(uuid);
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS payments_visible_to jsonb;

COMMENT ON COLUMN public.orgs.payments_visible_to IS
  'Jsonb array of LOGIN ids (users.id::text) allowed to see payment movement '
  '(ledger, draws, the /payments board). NULL = everyone. The OWNER always '
  'sees regardless. Edited on /settings (owner only). See migration 115.';

-- One place for the rule, used by every payment-table policy.
CREATE OR REPLACE FUNCTION public.can_see_payments(target_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.orgs o ON o.id = u.org_id
    WHERE u.auth_user_id = auth.uid()
      AND u.org_id = target_org
      AND (
        u.role = 'owner'
        OR o.payments_visible_to IS NULL
        OR o.payments_visible_to ? u.id::text
      )
  );
$$;

-- ── Seed: owner + current admins per org, only where not yet configured ──
UPDATE public.orgs o
SET payments_visible_to = seeded.ids
FROM (
  SELECT u.org_id, jsonb_agg(u.id::text) AS ids
  FROM public.users u
  WHERE u.role IN ('owner', 'admin')
  GROUP BY u.org_id
) AS seeded
WHERE seeded.org_id = o.id
  AND o.payments_visible_to IS NULL;

-- ── project_payments: org check (unchanged mechanism) + the allowlist ──
DROP POLICY IF EXISTS project_payments_own_org ON public.project_payments;
DROP POLICY IF EXISTS project_payments_allowlist ON public.project_payments;
CREATE POLICY project_payments_allowlist ON public.project_payments
  FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.can_see_payments(org_id)
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.can_see_payments(org_id)
  );

-- ── cash_flow_receivables: org pinned via the parent project (its own org_id
--    was nullable in 001 — 031's reasoning, kept) + the allowlist ──
DROP POLICY IF EXISTS cash_flow_receivables_select_authenticated ON public.cash_flow_receivables;
DROP POLICY IF EXISTS cash_flow_receivables_insert_authenticated ON public.cash_flow_receivables;
DROP POLICY IF EXISTS cash_flow_receivables_update_authenticated ON public.cash_flow_receivables;
DROP POLICY IF EXISTS cash_flow_receivables_delete_authenticated ON public.cash_flow_receivables;
DROP POLICY IF EXISTS cash_flow_receivables_allowlist ON public.cash_flow_receivables;
CREATE POLICY cash_flow_receivables_allowlist ON public.cash_flow_receivables
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = cash_flow_receivables.project_id
        AND p.org_id = public.current_org_id()
        AND public.can_see_payments(p.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = cash_flow_receivables.project_id
        AND p.org_id = public.current_org_id()
        AND public.can_see_payments(p.org_id)
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
