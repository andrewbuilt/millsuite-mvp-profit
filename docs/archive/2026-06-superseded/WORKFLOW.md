# WORKFLOW.md — how we actually build MillSuite

The end-to-end loop for shipping changes. This file is the source of truth for *process*. `STANDARDS.md` covers how the code itself must be written, `CLAUDE.md` covers context, `CURRENT-STATE.md` covers what's shipped, `BACKLOG.md` covers what's planned. This file connects them.

**The model: solo, work-on-main, no PRs.** Andrew is the only person in this repo. There is nobody to merge for, nobody to review-wait on. So we drop branch/PR/merge ceremony entirely and rely on **frequent commits on `main`** as the safety net. Speed with a clean undo button.

---

## The cast

**Andrew** — owner/builder. Decides scope, writes specs, drives everything.

**Cowork** (Claude desktop app) — thinking, planning, spec writing, deciding scope, drafting prompts, doc upkeep, cross-app work. Each chat is independent; context doesn't carry between chats, so plans get written to files.

**Claude Code** (one cockpit — terminal, desktop, or Cursor; pick one) — executes the actual coding on `main`. Auto-loads `CLAUDE.md` in this directory.

---

## Planning → execution

Plan at the right altitude, and **write the plan to a file** so it survives the handoff between tools and sessions:

- **Product / feature-level planning** ("what should this do, what's the cut, sequencing") → Cowork. Output lands in `BACKLOG.md` (and `BUILD-ORDER.md` if it's a whole phase).
- **Implementation planning** ("how do we change these files") → Claude Code's plan mode, because it can read the actual code first. A plan that can't see the codebase doesn't survive contact with it.

Never leave a plan only in chat. Chat is lossy; the repo is durable.

---

## Bootstrapping a Cowork session

Cowork doesn't auto-read files. Paste this opener at the start of a fresh chat:

```
Bootstrap: read these files in /Users/codecity/code/millsuite-mvp-profit/
in this order:
  1. CLAUDE.md
  2. CURRENT-STATE.md
  3. BACKLOG.md
  4. STANDARDS.md
  5. SYSTEM-MAP.md (skim — headers + one-sentence version, skip detail unless I ask)
Then run `git log --oneline -10` to see the most recent shipped work.
Confirm you've read them and tell me:
  - Where we left off (current focus)
  - Anything in flight or half-finished
  - Anything I should know before we start
```

Terminal/desktop Code sessions need no bootstrap — `CLAUDE.md` auto-loads.

---

## The build loop

For each meaningful change:

1. **Pick the work** from `BACKLOG.md` (or capture new scope there first).
2. **Plan if non-trivial** — implementation plan in Code's plan mode, or scope in Cowork, written down.
3. **Build it on `main`.**
4. **Commit as soon as it's coherent and working.** One change per commit, clear message. Don't batch a day's work into one commit — small commits are the revert granularity.
5. **Test the touched surface in dev** — load the page, do the action, watch for 500s. Don't wait until the end of the session to find out it's broken.
6. **Run any new migration against prod Supabase _before_ deploying** the code that needs it.
7. **Push to GitHub** (backup, not a gate).
8. **At end of session: update `CURRENT-STATE.md`** and groom `BACKLOG.md`. This is the ritual below.

No PR step. No "Andrew merges" step. The commit *is* the ship.

---

## Risk control without branches

The whole point of branches/PRs was a safety net. We get the same net more cheaply:

- **Commit before anything risky** (a big refactor, a schema migration, the Built OS data transfer). That commit is your restore point.
- **`git revert` / `git reset` is the undo.** Because commits are small and frequent, reverting one bad change doesn't take anything else down with it.
- **For a genuinely scary experiment**, spike a throwaway branch — but that's the exception, not the routine. The default is `main`.
- **Migrations are the one thing that can hurt prod.** Always run them in Supabase first; always write them idempotent (see `STANDARDS.md`).

---

## End-of-session ritual (do this every time)

Before closing a session that produced shipped work, run this — and any agent should do it **proactively**, not only when asked:

```
Wrap-up:
1. Rewrite CURRENT-STATE.md to match reality:
   - Move anything shipped today into "Shipped."
   - Update the migration ledger to the new top number.
   - Update the "current position" commit line.
2. Groom BACKLOG.md: delete finished items, add anything new we discovered,
   re-tag priorities if they shifted.
3. In 5 lines: where we left off, anything half-finished, the next obvious step.
```

That's the handoff. It's why the next session starts sharp instead of spending ten minutes reconstructing state. **`CURRENT-STATE.md` going stale is the failure mode that started this whole cleanup — don't let it happen again.**

---

## When to archive a doc

Move it to `docs/archive/` when it's fully implemented (tracking moved to `CURRENT-STATE.md`), explicitly superseded, contains obsolete schema/API references, or is >30 days old and unreferenced. **Archive, don't delete** — the design trail answers "why did we decide X?" — but quarantine it so nobody mistakes it for current spec.

---

## When to start a fresh Cowork session vs continue

- **Continue:** session is < ~1 hour old, no compaction yet, work is one conceptual arc.
- **Start fresh:** the session got compacted (you'll see a summary block at the top), the new task is a different domain, or you want a clean read of state. Compaction is lossy; fresh sessions stay sharp.
