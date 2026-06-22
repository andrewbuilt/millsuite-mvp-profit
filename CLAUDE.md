# CLAUDE.md — read this first

You're working on **MillSuite**, a Next.js + Supabase app for cabinet-shop estimating, scheduling, invoicing, and project management. Andrew is the solo owner/builder.

There are only two docs to care about:
- **This file** — how Andrew works. Stable; rarely changes.
- **`STATE.md`** — where things actually stand right now + the current todos. Read it at the start of every session. Rewrite it at the end (see ritual below).

Ignore `docs/archive/` — it's historical and may be stale. **When in doubt, read the actual code, not the docs.**

---

## How Andrew works

- **Solo. Work directly on `main`. Commit often** — one coherent change per commit. Commits are the undo button; there are no branches or PRs to merge.
- **Push to GitHub as backup**, never as a gate. No PR review, no merge step. The commit is the ship.
- **Test at intervals**, not at the end — run the app and exercise what you touched after each chunk.
- **Commit before anything risky** (a refactor, a schema migration) so there's a clean revert point.

## Which tool does what

- **Cowork (this desktop app)** — planning, thinking, scoping, specs, research, doc upkeep, cross-app work. Used to decide *what* to build and keep `STATE.md` honest.
- **Claude Code** — executes the actual coding on `main`. Auto-loads this file. Used to build *the thing*.

Plans get written into `STATE.md`, not left in chat — chat doesn't carry between sessions.

## Hard rules (the ones that bite)

- **Read the code before asserting anything about it.** Names and patterns drift; docs lag.
- **Schema migrations** live in `db/migrations/` (numbered; highest = current). Make them idempotent (`IF NOT EXISTS` on tables and columns), end with `NOTIFY pgrst, 'reload schema';`, and **run them against prod Supabase before deploying** the code that needs them.
- **Verify with greps, not just type-check** — type-check proves it compiles, grep proves it's wired.
- **Update `STATE.md` at the end of any session that changed something.**
- **Never build a `STATE.md` item marked `[unscoped]`.** It's an intent, not a spec. Bring it back to a Cowork planning pass and scope it with Andrew first — do not fill the gaps with assumptions.

## End-of-session ritual (do this every time, proactively)

Before wrapping a session that changed anything:

1. **Re-read `STATE.md` fresh first, and run `git status` / `git diff STATE.md`.** A separate planning (Cowork) session may have added or edited todos while you were building. Treat the current file as truth. **Preserve everything you didn't personally finish** — especially new items in "Now"/"On deck"/"Next." Never regenerate the file from scratch or delete a section you didn't touch.
2. Rewrite only what changed: move items *you* completed out, update "Where things stand," add/retag todos for what you did.
3. Delete finished todos; don't leave a graveyard. (Only ones that are actually done — not ones someone else added.)
4. Note in one line where you left off and the next obvious step.
5. **End the session by printing a short confirmation of what you changed in `STATE.md`** (which lines moved/added/removed, and confirm you preserved any pre-existing todos you didn't touch). If you changed code but have nothing to report here, you skipped the ritual — go back and do step 1. Andrew uses the absence of this confirmation as the signal that STATE wasn't updated.

This is the whole point: so the next session doesn't have to ask "where are we?"

## Architecture

Read the code. If you want a high-level orientation, there's a (possibly stale) `SYSTEM-MAP.md` and `BUILD-ORDER.md` in `docs/archive/` — treat them as a sketch, not truth.

## Related repo

`../built-os` is the predecessor — **frozen, do not build there.** Its live data will be migrated into MillSuite later, then it's archived. Plan: `../built-os/docs/DATA-MIGRATION-INVENTORY.md`.
