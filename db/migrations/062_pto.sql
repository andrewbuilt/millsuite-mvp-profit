-- ============================================================================
-- 062 — PTO requests + policies (chunk B)
-- ============================================================================
-- Workers request time off from the /me app; owners approve/deny on /team.
-- Approving a request writes per-day rows into capacity_overrides (045) so
-- /capacity + /schedule subtract the days with zero extra wiring; denying
-- or deleting removes them.
--
-- team_member_id here is the uuid carried inside orgs.team_members jsonb
-- (same identity capacity_overrides.team_member_id uses), NOT users.id.
-- Tenure for the balance bands is measured from team_members.start_date.
--
-- Idempotent (IF NOT EXISTS). Run against prod Supabase before deploying
-- the code that reads these tables.
-- ============================================================================

BEGIN;

-- ── PTO requests ──
CREATE TABLE IF NOT EXISTS public.pto_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL,           -- orgs.team_members jsonb id
  start_date     date NOT NULL,
  end_date       date NOT NULL,           -- = start_date for a single day
  reason         text NOT NULL DEFAULT 'PTO'
    CHECK (reason IN ('PTO', 'Sick', 'Personal', 'Other')),
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),
  notes          text NULL,
  approved_by    uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at    timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pto_requests_org      ON public.pto_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_pto_requests_member   ON public.pto_requests(team_member_id);
CREATE INDEX IF NOT EXISTS idx_pto_requests_status   ON public.pto_requests(org_id, status);

-- ── PTO policies (tenure-banded day allowances) ──
CREATE TABLE IF NOT EXISTS public.pto_policies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT 'Standard',
  is_default  boolean NOT NULL DEFAULT true,
  -- [{ min_years, max_years, days_per_year }] — first matching band wins.
  rules       jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes       text NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pto_policies_org ON public.pto_policies(org_id);

-- ── RLS: org-scoped, mirroring capacity_overrides (045). Any authed user in
--    the org can read; workers can insert their own requests; owners manage. ──
ALTER TABLE public.pto_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pto_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pto_requests_select ON public.pto_requests;
DROP POLICY IF EXISTS pto_requests_write  ON public.pto_requests;
CREATE POLICY pto_requests_select ON public.pto_requests FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = pto_requests.org_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY pto_requests_write ON public.pto_requests FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = pto_requests.org_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = pto_requests.org_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS pto_policies_select ON public.pto_policies;
DROP POLICY IF EXISTS pto_policies_write  ON public.pto_policies;
CREATE POLICY pto_policies_select ON public.pto_policies FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = pto_policies.org_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY pto_policies_write ON public.pto_policies FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = pto_policies.org_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = pto_policies.org_id AND u.auth_user_id = auth.uid()
  ));

NOTIFY pgrst, 'reload schema';

COMMIT;
