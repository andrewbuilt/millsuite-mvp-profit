# Template: new feature

Use for: shipping a new feature that touches schema, lib code, and UI. Strip sections that don't apply.

```
<feature name>

Goal: <one sentence describing what this PR delivers>

Reference patterns to mirror (do not reinvent):
  - <relevant existing component / file>
  - <relevant existing pattern>

────────────────────────────────────────────────────
1. SCHEMA — new migration (skip if no DB change)
────────────────────────────────────────────────────

File: db/migrations/<NEXT>_<descriptive_name>.sql

  BEGIN;

  CREATE TABLE IF NOT EXISTS public.<table_name> (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
    <other columns>,
    created_at      timestamptz NOT NULL DEFAULT now()
  );

  -- Defensive: every column also gets ADD COLUMN IF NOT EXISTS in case
  -- a half-baked previous run left the table skeletal.
  ALTER TABLE public.<table_name>
    ADD COLUMN IF NOT EXISTS <col1> <type>,
    ADD COLUMN IF NOT EXISTS <col2> <type>;

  CREATE INDEX IF NOT EXISTS idx_<table>_<col> ON public.<table_name>(<col>);

  ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS <table>_select ON public.<table_name>;
  DROP POLICY IF EXISTS <table>_write  ON public.<table_name>;

  CREATE POLICY <table>_select ON public.<table_name> FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users u
                   WHERE u.org_id = <table_name>.org_id
                   AND u.auth_user_id = auth.uid()));

  CREATE POLICY <table>_write ON public.<table_name> FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users u
                   WHERE u.org_id = <table_name>.org_id
                   AND u.auth_user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users u
                        WHERE u.org_id = <table_name>.org_id
                        AND u.auth_user_id = auth.uid()));

  COMMIT;

  NOTIFY pgrst, 'reload schema';

────────────────────────────────────────────────────
2. LIB CODE
────────────────────────────────────────────────────

File: lib/<feature>.ts (new) or extend lib/<existing>.ts

  <interface definitions>
  <pure functions for the feature>
  <wire-in points to existing code>

────────────────────────────────────────────────────
3. UI
────────────────────────────────────────────────────

File: <component or page>

  <which existing components to mirror>
  <what slots / props the new component takes>
  <how it integrates with the surrounding layout>

────────────────────────────────────────────────────
VERIFICATION (run all, paste output)
────────────────────────────────────────────────────

- grep -n "<distinctive_symbol>" <file>
  (must show <expected hits>)
- grep -n "<another predicate>" <other file>
- After running migration in Supabase: `select * from <table> limit 1;`
  (should not error)

Smoke test:
  1. <step-by-step user-facing test>
  2. <expected outcome>
  3. <verify the data landed in DB>

────────────────────────────────────────────────────
GROUND RULES
────────────────────────────────────────────────────

- Open ONE PR. Don't bundle scope.
- Rebase on origin/main before opening.
- Andrew merges. Do not self-merge.
- Paste verification output + post-merge `git log --oneline -5 main` in
  the PR description before requesting merge.
- Schema migration uses ADD COLUMN IF NOT EXISTS for every column +
  NOTIFY pgrst at the bottom.
```
