# Brief: seed demo completed-project data for marketing site screenshots

**For:** Claude Code, on `main`, local dev.
**Why:** The marketing site's proof section (see `docs/MILLSUITE-DESIGN-BRIEF.md` §9 and `docs/DESIGN-CODEX.md` §9.1) needs a real screenshot of the actual product's Reports → Completed Projects view, several jobs with varying margins, one expanded project detail pane. Not a design-tool mockup, the actual app UI. Built LLC's real org currently has zero completed projects in MillSuite (confirmed via screenshot 2026-09-14), so there's nothing real to screenshot yet. This seeds illustrative data so we can capture the real UI now, and swap in genuinely real jobs later once beta shops (or Built LLC) have closed some.

## Decision to confirm before seeding

**Recommend seeding into a dedicated demo/test org, not Built LLC's real org.** Mixing fake completed jobs into Built LLC's actual production data risks polluting real reporting and is harder to cleanly remove later. `scripts/create-customer-org.mjs` looks like the right tool to spin up a fresh org for this. If there's a reason to use Built LLC's org instead (e.g. it's already the one used for other marketing screenshots), flag that before proceeding rather than assuming.

## Data spec

Seed **7 completed projects** with this margin spread, deliberately not all-green:

| # | Type (Tampa custom millwork, fictional client) | Target margin band |
|---|---|---|
| 1 | Kitchen, painted shaker | 33-36% (comfortably above target) |
| 2 | Built-in / library wall | 33-36% (comfortably above target) |
| 3 | Kitchen, rift oak | 28-32% (on target) |
| 4 | Reception desk / retail fixture | 28-32% (on target) |
| 5 | Bar or vanity run | 28-32% (on target) |
| 6 | Closet system | 18-22% (tight but positive) |
| 7 | Storefront or commercial millwork | Ran hot enough to trigger a margin alert, ideally on Finish or Install hours specifically, and linked to a suggestion (rate correction proposal) so both the "Margin alerts" panel and a project detail pane have something real to show. |

Use plausible-but-clearly-fictional client names, not real prospect or customer names from `audience-intelligence` (McKusick, Zook, etc.), those aren't cleared for use anywhere, including as filler.

Department hours should track against the real labor departments (`lib/rate-book-seed.ts`: Engineering, CNC, Assembly, Finish, Install), not invented categories.

## Technical approach

- Follow the pattern in `scripts/create-customer-org.mjs` and `scripts/reset-org-data.mjs`, both already exist and presumably know the real schema, don't guess table/column names from outside the codebase.
- Idempotent: safe to re-run without duplicating projects, matches the project's general script conventions.
- Should be easy to fully remove later (either `reset-org-data.mjs` already covers this for a demo org, or note whatever's needed to clean it up).

## Labeling requirement

Whatever ends up on the marketing site sourced from this data must not be presented as real client results, this is seeded/illustrative data for a real UI screenshot. Copy should say so plainly (or the section should hold off entirely until real beta-tester jobs exist to replace it).

## Handoff back to Cowork

Once this is seeded and `npm run dev` is running locally (Andrew already has `.env.local` configured), let Cowork know. From there, screenshots of the Reports → Completed Projects view (list + one expanded detail pane) can be captured directly through the browser for use in the marketing site.
