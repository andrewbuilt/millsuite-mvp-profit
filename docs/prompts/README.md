# Prompt templates

Reusable Code prompt scaffolds. Start from one of these rather than from a blank page when writing a prompt for Claude Code.

## Templates

- **`new-feature.md`** — schema migration + lib code + UI + verification greps + smoke test. The most common prompt shape.
- **`bug-fix.md`** — diagnosis + root cause + fix + regression test. Use when something broke.
- **`rebase.md`** — pull a stale branch onto current main, drop reverts, open a fresh PR.
- **`follow-up.md`** — small additional commit on an already-open PR.

## How to use

1. Open the matching template.
2. Copy the structure into your message to Code.
3. Fill in the `<placeholders>`.
4. Strip sections that don't apply.
5. Send.

## Ground rules every template enforces

- Verification greps + smoke test must be in the prompt.
- Andrew merges; Code never self-merges.
- Schema migrations use `CREATE TABLE IF NOT EXISTS` paired with explicit `ALTER TABLE ADD COLUMN IF NOT EXISTS` for every column, ending in `NOTIFY pgrst, 'reload schema'`.
- Post-merge `git log --oneline -5 main` pasted in the PR description.

These exist because each one has been violated at least once and cost real time. Don't drop them.
