# WORKFLOW.md — how Andrew + Cowork + Claude Code actually work

The end-to-end flow for shipping changes to MillSuite. This file is the source of truth for *process*. `CLAUDE.md` covers context loading, `CURRENT-STATE.md` covers what's shipped, `BUILD-ORDER.md` covers what's planned. This file covers the loop that connects them.

---

## The cast

**Andrew** — drives everything. Specs, decisions, merges, beta-tester comms.

**Cowork** (Claude desktop app) — used for thinking, spec writing, deciding scope, drafting Code prompts. Each chat session is independent — context doesn't carry between chats.

**Claude Code** (terminal) — used for executing PRs. Reads `CLAUDE.md` automatically when invoked in this directory. Runs from a checked-out git branch, opens PRs against `main`.

---

## Bootstrapping a Cowork session

Cowork doesn't auto-read files. Paste this opener at the start of every fresh chat:

```
Bootstrap: read these files in /Users/codecity/code/millsuite-mvp-profit/
in this order:
  1. CLAUDE.md
  2. CURRENT-STATE.md
  3. WORKFLOW.md
  4. SYSTEM-MAP.md (skim — section headers + the one-sentence version,
     skip details unless I ask)
Then run `git log --oneline -10` to see the most recent shipped work.
Confirm you've read them and tell me:
  - What's currently in flight (any open PRs)
  - Anything blocked
  - Anything I should know before we start
```

That takes ~30 seconds and saves 10 minutes of "what state are we in?" back-and-forth.

For terminal Code sessions, no bootstrap needed — `CLAUDE.md` auto-loads.

---

## The shipping loop

For each meaningful change:

1. **Decide scope in Cowork.** Discuss the feature/bug, identify file paths, surface unknowns. End with a Code prompt block.
2. **Send the prompt to Code in terminal.** Code branches off `main`, implements, opens a PR with verification output pasted in the description.
3. **Verify before merging.** Read Code's verification grep output. If anything is missing, push back — don't merge yet.
4. **Smoke test in dev** if the change touches anything user-facing.
5. **Run any new migration** in Supabase SQL editor *before* merging the PR (otherwise prod 500s on the first request after deploy).
6. **Andrew merges via GitHub UI.** Never Code, never Cowork. Vercel auto-promotes `main` to production.
7. **Paste post-merge `git log --oneline -5`** so we both see the same state.
8. **Update `CURRENT-STATE.md`** if this PR shipped something user-visible. Move the bullet from "Open" to "Shipped." This is the single most-skipped step and the one that keeps the next session sharp.

---

## Ground rules (non-negotiable)

These have all been violated at least once and cost real time:

- **One PR at a time.** Don't bundle scope. Don't pile new features onto an open PR.
- **Andrew merges. Code never self-merges** under any condition. If a PR has been open >24h with no feedback, ping rather than merge.
- **Verify with greps, not just type-check.** Type-check proves it compiles, grep proves the feature is wired. Every PR description includes the grep commands the spec asked for plus their output.
- **Read the code, not memory.** If you're about to assert something about the codebase, open the file. Names and patterns change.
- **Schema migrations: pair `CREATE TABLE IF NOT EXISTS` with explicit `ALTER TABLE ADD COLUMN IF NOT EXISTS` for every column**, end with `NOTIFY pgrst, 'reload schema'`. Half-baked previous runs have caused PGRST204 cache misses repeatedly.
- **Run migrations against prod Supabase before merging the PR that depends on them.** Vercel deploys in seconds; don't ship a deploy that 500s for an hour while you go find the SQL editor.

---

## Prompt templates

Reusable scaffolds for common Code prompts live at `docs/prompts/`. Read those for the canonical shape. Quick reference:

- **`new-feature.md`** — schema migration + lib code + UI + verification greps + smoke test.
- **`bug-fix.md`** — diagnosis + root cause + fix + regression test.
- **`rebase.md`** — pull stale branch onto current main, drop reverts, open fresh PR.
- **`follow-up.md`** — when an open PR needs another small commit.

When writing a fresh prompt, start from one of those rather than from a blank page.

Universal structure for every Code prompt:

```
Goal: <one sentence>

<scoped sections — schema, lib, UI, etc.>

VERIFICATION (run all, paste output):
- grep -n "<predicate>" <file>
- <smoke test steps>
- git log --oneline -5 main after merge

GROUND RULES:
- Rebase on origin/main
- Andrew merges, do not self-merge
- Paste verification output in PR description
```

---

## End-of-session ritual

Before closing a Cowork session that produced merged work, ask me:

```
Wrap-up:
1. Update CURRENT-STATE.md with what we shipped today.
2. Summarize the open PRs (if any) and the next-up queue in 5 lines.
3. Note anything I should know before the next session starts.
```

That gives you a clean handoff. No context loss between sessions.

---

## When to archive

Move docs to `docs/archive/` when:
- Their content has been fully implemented and the tracking moved to `CURRENT-STATE.md`.
- They're explicitly marked superseded.
- They contain obsolete schema, migration, or API references.
- They're > 30 days old and nobody is referencing them.

Don't delete. Archive. The design trail is occasionally useful for "why did we decide X?" — but only when it's quarantined so nobody mistakes it for current spec.

---

## Beta tester feedback flow

Each piece of feedback from a beta tester:

1. **Open a fresh Cowork session.** Don't pile beta feedback into a long-running chat.
2. **Paste the bootstrap opener** + the bug report.
3. **Triage:** is it a bug, a missing feature, or a usability issue?
4. **For bugs:** investigate the relevant code, write a fix prompt, send to Code, merge after verification.
5. **For missing features:** scope check — does this fit MVP scope or is it future? File in `BUILD-ORDER.md` Phase 13 if future.
6. **For usability issues:** decide whether to fix now or batch with other UX polish.
7. **Update `CURRENT-STATE.md`** with the resolution.

---

## When to start a new Cowork session vs continue

- **Continue:** the current session is < 1 hour old, no compaction has happened, and the work is conceptually a single arc.
- **Start fresh:** the current session has been compacted (you'll see a summary block at the top), the new task is a different domain, or you want a clean read of state.

Compaction is lossy. Long sessions accumulate paraphrased history that drifts from the actual code. Fresh sessions stay sharp.
