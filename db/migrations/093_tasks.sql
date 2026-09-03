-- ============================================================================
-- 093 — tasks + task_comments (Task system v1)
-- ============================================================================
-- Replaces the "BUILT Master Action List" Google Sheet that Kaylin curates
-- daily. What had to survive from the sheet, and why the shape looks like it
-- does:
--
--   BUCKETS, NOT DUE DATES. The sheet's "When" column is Today / This Week /
--   Next Week / Someday, and nothing auto-rolls — a stale Today item stays in
--   Today until a human moves it. That daily pass IS the process, so `bucket`
--   is a plain curated column and there is deliberately no due_date and no
--   scheduled job to age things.
--
--   MULTI-ASSIGNEE, as jsonb. The sheet routinely puts two or three names on
--   a row. `assignee_ids` is an array of users.id (managers/owners have
--   logins; names render from the roster). A join table would be the textbook
--   answer, but v1 never queries "tasks for user X" from the database — the
--   whole org's list is a few dozen rows loaded at once and filtered in the
--   client. Promote it if that stops being true.
--
--   PROJECT OPTIONAL. The sheet has plain TASK rows with no job attached, so
--   `project_id` is nullable — and ON DELETE SET NULL, because deleting a
--   practice project shouldn't delete somebody's action item.
--
--   ONE SHARED LIST. Any manager/owner can edit any task, same trust model as
--   a shared spreadsheet. That's the org-wide FOR ALL policy below, not an
--   oversight.
--
-- Idempotent. RLS follows the `projects` FOR-ALL pattern from 083.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- Nullable: the sheet's standalone TASK rows. SET NULL so a task outlives
  -- the project it was attached to.
  project_id    uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  title         text NOT NULL,
  bucket        text NOT NULL DEFAULT 'today'
                  CHECK (bucket IN ('today', 'this_week', 'next_week', 'someday')),
  -- Array of users.id. See the note above on why this isn't a join table.
  assignee_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Stamped on completion; NULL = open. A timestamp rather than a boolean so
  -- the Done section can hide anything finished more than a week ago without
  -- a second column.
  done_at       timestamptz NULL,
  created_by    uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  -- Manual ordering within a bucket (drag to reorder). Numeric so a row can
  -- be dropped between two others without renumbering the list.
  sort_order    numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_org ON public.tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON public.tasks(project_id);

CREATE TABLE IF NOT EXISTS public.task_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_user_id  uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.task_comments(task_id);

-- ── RLS ──
-- FOR ALL scoped to the caller's org, matching `projects` (083). The shared
-- master list is the point: everyone in the org sees and edits the same rows.

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_own_org ON public.tasks;
CREATE POLICY tasks_own_org ON public.tasks
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_comments_own_org ON public.task_comments;
CREATE POLICY task_comments_own_org ON public.task_comments
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
