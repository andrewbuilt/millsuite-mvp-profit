-- ============================================================================
-- 098 — tasks.links + tasks.tags + orgs.task_tags  (small fixes wave 4, items 3+5)
-- ============================================================================
-- Two additions to the shared action list (093), both jsonb arrays on `tasks`
-- plus one org-level registry.
--
--   LINKS — `[{url, label?}]`. The sheet this replaces had people pasting a
--   Dropbox or supplier URL into the Notes column, where it was unclickable
--   and got overwritten by the next note. An array rather than a text column
--   because a task routinely carries two or three (the drawing, the quote,
--   the order confirmation).
--
--   TAGS — `["Shop", "Punch list"]`, an array of NAMES, not ids.
--   ⛔ THE NAMES ARE THE DATA. `orgs.task_tags` (`[{name, color}]`) is only a
--   registry for the picker and the colour, so renaming a tag there does NOT
--   rewrite the tasks already carrying the old name — they keep it and simply
--   stop matching the registry (they render in a neutral colour). That is a
--   deliberate v1 tradeoff, not an oversight: the alternative is ids plus a
--   migration for every rename, and a shop with a dozen tags doesn't need it.
--   The UI says so where you rename. Revisit if tags ever grow beyond that.
--
-- Why jsonb on the row and not child tables: same reasoning as `assignee_ids`
-- in 093 — the whole org's task list is a few dozen rows loaded at once and
-- filtered in the client. Nothing queries "tasks with tag X" from the
-- database. Promote to real tables if that stops being true.
--
-- NOT NULL + DEFAULT '[]' so nothing has to cope with a null array: every
-- existing task reads as "no links, no tags" and this migration cannot change
-- how anything behaves on its own.
--
-- Idempotent. No RLS change — `tasks` and `orgs` already carry their policies.
-- ============================================================================

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The org's tag registry: [{name, color}]. Empty = no tags defined yet, which
-- is the correct starting state for every org including Built.
ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS task_tags jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.tasks.links IS
  'Array of {url, label?} — reference links on a task (drawing, quote, order '
  'confirmation). Replaces URLs pasted into the old sheet''s Notes column.';

COMMENT ON COLUMN public.tasks.tags IS
  'Array of tag NAMES (not ids). orgs.task_tags is a registry for the picker '
  'and colour only; renaming there does not rewrite these. See migration 098.';

COMMENT ON COLUMN public.orgs.task_tags IS
  'Tag registry for the task system: [{name, color}]. Names are the join key '
  'to tasks.tags — a rename does NOT rewrite existing tasks (v1 tradeoff).';

COMMIT;

NOTIFY pgrst, 'reload schema';
