-- ============================================================================
-- 087 — split compensation out of the employee record
-- ============================================================================
-- THE PROBLEM
--
-- Everything about an employee lived in one jsonb blob, `orgs.team_members`:
-- name, title, contact, hours, departments, login link — AND salary. That one
-- coupling caused three separate failures:
--
--   1. Managers can't see the roster at all. Hiding salaries (7a5fa9a) had to
--      gate the ENTIRE roster block behind owner-only, because salary was in
--      the same object. A manager opening /team today sees only Time off.
--   2. Two pages had to edit the same blob (/team for everything, /settings
--      for salary), so they overlapped on name + billable and each showed a
--      different half of the record — edits looked lost when you checked the
--      other page.
--   3. Whole-blob writes let a stale page revert another's edits (fixed in
--      16ff21b with a three-way merge, but the coupling is what forced it).
--
-- THE FIX
--
-- Salary moves to its own table with an owner-only policy. `team_members`
-- keeps the employee record and stops carrying money, so the roster can be
-- shown to managers and each field has exactly one editor.
--
-- This also closes the leak fix-list-#5 knowingly left open: comp was stripped
-- from the /api/team/setup response, but any manager could still read it
-- straight out of orgs.team_members. Now the database itself refuses.
--
-- `annual_comp` stays on the in-memory TeamMember type, populated from this
-- table for readers allowed to see it and 0 for everyone else — so every
-- shop-rate calculation keeps working unchanged.
--
-- SAFE TO RUN BEFORE DEPLOYING: it only adds a table and copies data in.
-- The old annual_comp values stay in team_members until 088 clears them, so
-- the current build keeps working while this is applied.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.team_compensation;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.team_compensation (
  org_id      uuid        NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- The team_members[].id this figure belongs to. Text, not uuid: legacy
  -- members carry ids like "tm_1712…" from makeTeamMember's fallback.
  member_id   text        NOT NULL,
  annual_comp numeric     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, member_id)
);

ALTER TABLE public.team_compensation ENABLE ROW LEVEL SECURITY;

-- OWNER ONLY. Not "authenticated", not admins — the whole point is that a
-- manager login cannot read salaries even with a direct query.
DROP POLICY IF EXISTS team_compensation_owner_only ON public.team_compensation;
CREATE POLICY team_compensation_owner_only ON public.team_compensation
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.org_id = team_compensation.org_id
        AND u.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.org_id = team_compensation.org_id
        AND u.role = 'owner'
    )
  );

-- Backfill from the blob. Idempotent: re-running leaves existing rows alone
-- rather than resetting a figure edited since.
INSERT INTO public.team_compensation (org_id, member_id, annual_comp)
SELECT o.id,
       m.value ->> 'id',
       COALESCE((m.value ->> 'annual_comp')::numeric, 0)
FROM public.orgs o
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(o.team_members) = 'array' THEN o.team_members
    ELSE '[]'::jsonb
  END
) AS m(value)
WHERE m.value ->> 'id' IS NOT NULL
ON CONFLICT (org_id, member_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
