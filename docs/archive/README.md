# Archive

Historical docs from the build process. **Source of truth is the repo state plus `git log` and the current top-level docs (`README.md`, `CLAUDE.md`, `CURRENT-STATE.md`, `WORKFLOW.md`, `BUILD-ORDER.md`, `SYSTEM-MAP.md`).**

These files are preserved because the design trail is occasionally useful — re-discovering why a decision was made, recovering an old wireframe, etc. They are *not* authoritative and should not be cited in new work without checking against the current code.

## What's here

### `2026-04-historical/`
Snapshot from late-April 2026, when Phase 12 was wrapping up and dogfood-driven fixes were being shipped in batches.

- `CLAUDE-CODE-HANDOFF-2026-04-24.md` — Phase 12 close-out scope.
- `CLAUDE-CODE-HANDOFF-DOGFOOD-2026-04-24.md` — issues 1-8 from first dogfood pass.
- `CLAUDE-CODE-HANDOFF-DOGFOOD2-2026-04-24.md` — issues 9-12.
- `CLAUDE-CODE-HANDOFF-DOGFOOD3-2026-04-24.md` — issues 13-15.
- `CLAUDE-CODE-HANDOFF-DOGFOOD4-2026-04-24.md` — issues 17-20+, including the 8x labor bug fix.
- `ONBOARDING-PLAN.md` — design trail for the welcome / calibration first-run flow. Self-marked historical.
- `PRICING-ARCHITECTURE-AUDIT-2026-04-24.md` — single-source-of-margin-truth audit + redesign. Implemented.
- `REPORTING-AUDIT.md` / `REPORTING-STATUS.md` — pre-Phase-12 reporting surface snapshots.
- `archived-millsuite-com-copy.md` — original marketing site copy from before the MVP landing rewrite.

### `old-sql/`
SQL files that predate the numbered `db/migrations/` system. **Do not run.** They were ad-hoc patches whose contents have since been folded into proper migrations.

- `migration.sql` — initial schema scratch.
- `migration-reporting.sql` — reporting tables.
- `migration-scheduling.sql` — scheduling tables.

## How to navigate

If you're looking for "why did we decide X?" — check git log first (commit messages explain the actual change). If git log is too thin, scan the relevant handoff in `2026-04-historical/`. Don't treat anything in here as a current spec.
