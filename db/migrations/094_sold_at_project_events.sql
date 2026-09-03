-- ============================================================================
-- 094 — projects.sold_at + project_events (Small fixes wave 3, items 5 + 6)
-- ============================================================================
-- Two things that both come down to the same gap: the app changes a project's
-- state constantly and RECORDS none of it. `stage` is a single column that gets
-- overwritten, so "when did this sell?" and "what happened on this job?" are
-- both unanswerable today.
--
--   sold_at — stamped on every transition INTO 'sold'. Drives "Sold 12d ago"
--   on the project cards. Deliberately NOT backfilled: there is no honest
--   source for when the existing projects sold, and inventing one (created_at,
--   or the migration date) would put a confident wrong number on a card. Rows
--   that predate this show nothing at all, which is the truthful answer.
--
--   project_events — an append-only log. Written best-effort at the writers:
--   an event insert must NEVER fail the operation it describes, so every call
--   site swallows its own errors. A missing event is a cosmetic gap in a
--   timeline; a failed stage change because logging broke is a real outage.
--
-- Why a table and not a view over existing columns: most of what belongs on a
-- timeline (a CO signed, a payment recorded, an invoice pushed) leaves no
-- dated trace anywhere. The columns that DO exist — created_at, imported_at,
-- estimate_sent_at, sold_at — are rendered as derived pseudo-events by the UI
-- instead, so old projects aren't empty. Those are computed at read time and
-- never written here.
--
-- Idempotent. RLS follows the `projects` FOR-ALL pattern from 083.
-- ============================================================================

BEGIN;

-- ── Item 5: when did it sell ──
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS sold_at timestamptz NULL;

COMMENT ON COLUMN public.projects.sold_at IS
  'Stamped on transition INTO stage=sold. NULL for projects that sold before '
  'migration 094, and for anything never sold. Not backfilled on purpose.';

-- ── Item 6: the timeline ──
CREATE TABLE IF NOT EXISTS public.project_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- CASCADE, unlike tasks.project_id: an event is ABOUT a project and means
  -- nothing without it. A task outlives its project; a log line doesn't.
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Free text rather than an enum. New event types get added by shipping a
  -- call site, and an enum would make every new one a migration; the UI
  -- already has to tolerate a type it doesn't recognise.
  event_type      text NOT NULL,
  -- Pre-rendered human sentence ("Stage changed to In Production"). Stored
  -- rather than derived so an old event still reads correctly after the code
  -- that produced it has changed.
  label           text NOT NULL,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id   uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The only query this table serves: one project's events, newest first.
CREATE INDEX IF NOT EXISTS idx_project_events_project_created
  ON public.project_events(project_id, created_at DESC);

ALTER TABLE public.project_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_events_own_org ON public.project_events;
CREATE POLICY project_events_own_org ON public.project_events
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
