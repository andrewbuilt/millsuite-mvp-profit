-- ============================================================================
-- 045 — Capacity overrides (company holidays + individual PTO)
-- ============================================================================
-- Reduces a month's effective capacity by:
--   - Company holidays (team_member_id NULL, optionally scoped to a single
--     department via department_id) — drop one working day from the dept(s).
--   - Individual PTO (team_member_id NOT NULL) — subtract hours_reduction
--     for that person on that date. hours_reduction = 0 means "use the
--     person's default day length."
--
-- team_member_id is the uuid carried inside orgs.team_members jsonb (set
-- by makeTeamMember in lib/shop-rate-setup.ts). It is NOT an FK to users
-- because the shop-rate setup keeps team members as a jsonb array on
-- orgs (not as users rows). Inactive / deleted members still leave their
-- override rows behind by default; clean-up is a Settings concern.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.capacity_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  override_date   date NOT NULL,
  team_member_id  uuid NULL,
  department_id   uuid NULL REFERENCES public.departments(id) ON DELETE SET NULL,
  reason          text NOT NULL DEFAULT '',
  hours_reduction numeric NOT NULL DEFAULT 0,
  is_full_day     boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cap_overrides_org_date
  ON public.capacity_overrides(org_id, override_date);
CREATE INDEX IF NOT EXISTS idx_cap_overrides_member
  ON public.capacity_overrides(team_member_id);

ALTER TABLE public.capacity_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capacity_overrides_select ON public.capacity_overrides;
DROP POLICY IF EXISTS capacity_overrides_write  ON public.capacity_overrides;

CREATE POLICY capacity_overrides_select ON public.capacity_overrides FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = capacity_overrides.org_id AND u.auth_user_id = auth.uid()
  ));

CREATE POLICY capacity_overrides_write ON public.capacity_overrides FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = capacity_overrides.org_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = capacity_overrides.org_id AND u.auth_user_id = auth.uid()
  ));

COMMIT;
