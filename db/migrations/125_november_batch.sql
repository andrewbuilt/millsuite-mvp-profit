-- ============================================================================
-- 125 — November batch (2026-11-03)
-- ============================================================================
-- One file for the batch, per the plan in STATE.md. Sections land as each item
-- is built; run the WHOLE file once, before deploying any of them.
--
-- ── Item 2: install gets its own margin ─────────────────────────────────────
-- 052 mapped labor + install onto ONE knob (labor_margin_pct). Andrew wants
-- them apart: shop labor and install priced at their own true gross margins.
--
--   orgs.install_margin_pct       — the org default (NULL = follow labor)
--   projects.install_margin_pct   — the per-project pin (NULL = inherit)
--   projects.locked_margins.install, projects.margins_ignored.install
--                                 — the 121 lock / "Keep" memory gain a key
--
-- ⛔ NOTHING MAY MOVE. Every backfill copies the LABOR value at the same level,
-- so each project's install margin resolves to exactly what it priced at
-- yesterday (labor). Proof: scripts/verify-install-margin.mjs.
--   · org:      install = labor (NULL stays NULL — the code then follows labor)
--   · project:  install pin = labor pin, only where labor is pinned
--   · lock:     locked_margins.install = locked_margins.labor
--   · ignored:  margins_ignored.install = margins_ignored.labor (else the
--               margin banner would re-offer on every job someone "Kept")
-- The 121 stamp trigger now stamps install too (org install → org labor → 35).
--
-- Idempotent. No RLS change (columns on org-policied tables).
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS install_margin_pct numeric NULL;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS install_margin_pct numeric NULL;

ALTER TABLE public.orgs DROP CONSTRAINT IF EXISTS orgs_install_margin_pct_range;
ALTER TABLE public.orgs
  ADD CONSTRAINT orgs_install_margin_pct_range
    CHECK (install_margin_pct IS NULL OR (install_margin_pct >= 0 AND install_margin_pct < 100));
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_install_margin_pct_range;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_install_margin_pct_range
    CHECK (install_margin_pct IS NULL OR (install_margin_pct >= 0 AND install_margin_pct < 100));

UPDATE public.orgs
   SET install_margin_pct = labor_margin_pct
 WHERE install_margin_pct IS NULL
   AND labor_margin_pct IS NOT NULL;

UPDATE public.projects
   SET install_margin_pct = labor_margin_pct
 WHERE install_margin_pct IS NULL
   AND labor_margin_pct IS NOT NULL;

UPDATE public.projects
   SET locked_margins = locked_margins || jsonb_build_object('install', locked_margins->'labor')
 WHERE locked_margins IS NOT NULL
   AND locked_margins ? 'labor'
   AND NOT (locked_margins ? 'install');

UPDATE public.projects
   SET margins_ignored = margins_ignored || jsonb_build_object('install', margins_ignored->'labor')
 WHERE margins_ignored IS NOT NULL
   AND margins_ignored ? 'labor'
   AND NOT (margins_ignored ? 'install');

CREATE OR REPLACE FUNCTION public.stamp_project_margins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.locked_margins IS NULL AND NEW.org_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'labor',      COALESCE(o.labor_margin_pct, 35),
             'install',    COALESCE(o.install_margin_pct, o.labor_margin_pct, 35),
             'material',   COALESCE(o.material_margin_pct, 35),
             'consumable', COALESCE(o.consumable_margin_pct, 35))
      INTO NEW.locked_margins
      FROM public.orgs o
     WHERE o.id = NEW.org_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_project_margins() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.orgs.install_margin_pct IS
  'Default true gross margin on install cost (125). NULL = follow labor_margin_pct.';
COMMENT ON COLUMN public.projects.install_margin_pct IS
  'Install margin pin (125). NULL = inherit locked_margins.install, then the org.';

-- ── Item 3: the pre-production HANDOFF + project notes with @mentions ───────
-- Handoff facts on the project (lib/handoff). The jobsite address is the
-- existing delivery_address. client_deadline is TEXT on purpose: "ASAP" is a
-- real answer. Contact + address + deadline gate sold → production (imported
-- jobs exempt); site access is reference only. No backfill — a sold job
-- missing them simply shows them on its What's-left rail.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS poc_name          text NULL,
  ADD COLUMN IF NOT EXISTS poc_phone         text NULL,
  ADD COLUMN IF NOT EXISTS poc_email         text NULL,
  ADD COLUMN IF NOT EXISTS client_deadline   text NULL,
  ADD COLUMN IF NOT EXISTS site_access_notes text NULL;

-- Notes. author_id is a LOGIN id (users.id) — lib/project-comments.
CREATE TABLE IF NOT EXISTS public.project_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_id   uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  body        text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_comments_project
  ON public.project_comments(project_id, created_at DESC);

-- One row per mentioned login; acknowledged_at = they closed it out (the 114
-- close-the-loop pattern). In-app only — no email.
CREATE TABLE IF NOT EXISTS public.project_comment_mentions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  comment_id      uuid NOT NULL REFERENCES public.project_comments(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_comment_mentions_open
  ON public.project_comment_mentions(user_id) WHERE acknowledged_at IS NULL;

-- RLS. Org-scoped through current_org_id() (083). Notes: anyone in the shop
-- reads and writes; you write AS yourself and delete only your own. Mentions:
-- created by anyone in the shop, closed out only by the person mentioned.
-- The client portal reads through its own token route and never these tables.
ALTER TABLE public.project_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_comment_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_comments_select ON public.project_comments;
DROP POLICY IF EXISTS project_comments_insert ON public.project_comments;
DROP POLICY IF EXISTS project_comments_delete ON public.project_comments;
CREATE POLICY project_comments_select ON public.project_comments FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());
CREATE POLICY project_comments_insert ON public.project_comments FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND author_id = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1)
  );
CREATE POLICY project_comments_delete ON public.project_comments FOR DELETE TO authenticated
  USING (
    org_id = public.current_org_id()
    AND author_id = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS comment_mentions_select ON public.project_comment_mentions;
DROP POLICY IF EXISTS comment_mentions_insert ON public.project_comment_mentions;
DROP POLICY IF EXISTS comment_mentions_update ON public.project_comment_mentions;
CREATE POLICY comment_mentions_select ON public.project_comment_mentions FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());
CREATE POLICY comment_mentions_insert ON public.project_comment_mentions FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id());
CREATE POLICY comment_mentions_update ON public.project_comment_mentions FOR UPDATE TO authenticated
  USING (
    org_id = public.current_org_id()
    AND user_id = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1)
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND user_id = (SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid() LIMIT 1)
  );

-- ── Item 4: employee reviews + notes (the /team expansion) ───────────────────
-- member_id is the ROSTER id (orgs.team_members[].id) — the identity PTO and
-- capacity use — so a person without a login can still be reviewed.
--
-- ⛔ THE NO-BLINDSIDE RULE IS IN THE POLICY, NOT JUST THE UI (Andrew): managers
-- (owner/admin) read and write everyone's; a worker READS their own rows —
-- reviews, action items AND the offense log — and nothing else. An offense the
-- employee can't see defeats the purpose. Keyed on the roster link
-- (team_members[].user_id = their users.id), the payments-allowlist pattern.
-- Review/offense text stays on /team and /me only: no export or report reads it.

CREATE TABLE IF NOT EXISTS public.employee_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  member_id      uuid NOT NULL,                -- orgs.team_members[].id
  scheduled_at   date NULL,
  held_at        date NULL,
  strengths      text NULL,                    -- "doing well"
  improvements   text NULL,                    -- "needs improvement"
  action_items   text NULL,
  author_id      uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  task_fired_at  timestamptz NULL,             -- the "review coming up" Today task, once
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_reviews_member ON public.employee_reviews(org_id, member_id);

CREATE TABLE IF NOT EXISTS public.employee_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL,                   -- orgs.team_members[].id
  kind        text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'offense')),
  note_date   date NOT NULL DEFAULT CURRENT_DATE,
  body        text NOT NULL CHECK (length(btrim(body)) > 0),
  author_id   uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_notes_member ON public.employee_notes(org_id, member_id);

-- Owner or admin of target_org.
CREATE OR REPLACE FUNCTION public.is_org_manager(target_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.org_id = target_org
      AND u.role IN ('owner', 'admin')
  );
$$;

-- The caller's roster id(s) in target_org, as text (roster ids live in jsonb).
CREATE OR REPLACE FUNCTION public.my_roster_member_ids(target_org uuid)
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m->>'id'
  FROM public.users u
  JOIN public.orgs o ON o.id = u.org_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.team_members, '[]'::jsonb)) m
  WHERE u.auth_user_id = auth.uid()
    AND o.id = target_org
    AND m->>'user_id' = u.id::text;
$$;

REVOKE ALL ON FUNCTION public.is_org_manager(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_roster_member_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_roster_member_ids(uuid) TO authenticated;

ALTER TABLE public.employee_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_reviews_select ON public.employee_reviews;
DROP POLICY IF EXISTS employee_reviews_write  ON public.employee_reviews;
CREATE POLICY employee_reviews_select ON public.employee_reviews FOR SELECT TO authenticated
  USING (
    org_id = public.current_org_id()
    AND (
      public.is_org_manager(org_id)
      OR member_id::text IN (SELECT public.my_roster_member_ids(org_id))
    )
  );
CREATE POLICY employee_reviews_write ON public.employee_reviews FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_manager(org_id))
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_manager(org_id));

DROP POLICY IF EXISTS employee_notes_select ON public.employee_notes;
DROP POLICY IF EXISTS employee_notes_write  ON public.employee_notes;
CREATE POLICY employee_notes_select ON public.employee_notes FOR SELECT TO authenticated
  USING (
    org_id = public.current_org_id()
    AND (
      public.is_org_manager(org_id)
      OR member_id::text IN (SELECT public.my_roster_member_ids(org_id))
    )
  );
CREATE POLICY employee_notes_write ON public.employee_notes FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_org_manager(org_id))
  WITH CHECK (org_id = public.current_org_id() AND public.is_org_manager(org_id));

COMMIT;

NOTIFY pgrst, 'reload schema';
