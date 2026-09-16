# Bug: Completed Projects margin bar wrong width for one row

**Found:** 2026-09-16, while pulling marketing screenshots from the Bayside Millworks demo org (Reports → Completed Projects).
**Confirmed real, not a rendering artifact:** persists after a hard refresh.

## Symptom

On `/reports`, the "Completed projects" list shows 7 rows. "Sandpiper Lane Library Wall" (delivered Aug 28, 211h est / 213.5h actual) displays **+35.0%** and **$16,953**, correct text, matching its seed spec. But its margin bar renders dramatically short, roughly a fifth the length of "Vega Residence" right above it, which shows a near-identical +35.3% margin with a bar that runs nearly full length. Every other row's bar length looks proportionate to its displayed percentage. Only this one row is wrong.

## What I checked (rules out the obvious causes)

- `app/(app)/reports/components/CompletedProjects.tsx`: bar width formula is `(Math.abs(project.marginPct) / maxMargin) * 100`, and the percentage text renders from that same `project.marginPct`, same object, same render pass. No separate calculation path for the two.
- `app/(app)/reports/page.tsx` line ~251: `marginPct: o.actual_margin_pct`, pulled directly from the DB row, no client-side override.
- `scripts/seed-demo-completed-projects.mjs`: computes `marginPct = (margin / revenue) * 100` for every job and **refuses to seed if it falls outside a hardcoded band** (job 2's band is 33–36%, so whatever got inserted passed that check at seed time, self-verified 35.0%ish).
- Ruled out a `transition-all duration-500` animation-timing artifact, confirmed still wrong after a hard reload.

Since text and bar provably share one source value in the component, and that value passed the seed script's own band check, the mismatch has to be happening somewhere between what the seed script computed and what's actually sitting in the row Reports is reading today, not in the rendering logic.

## Leading hypothesis (unconfirmed, needs a DB look)

`scripts/seed-demo-completed-projects.mjs` looks like it was iterated on (the margin-band guard and the job-7 alert-window guard both read like they were added after an earlier bad run). If it was run more than once against the Bayside Millworks org without fully cleaning up the previous attempt, there may be a duplicate or orphaned `project_outcome`/project row for "Sandpiper Lane Library Wall" left over from an earlier, wrong seed pass, one row with a bad `actual_margin_pct` that only affects that specific project's bar width some other way (e.g., something upstream of `page.tsx` that's supposed to pick the latest/correct row but isn't).

Worth checking directly:
1. Query `project_outcome` (or wherever `actual_margin_pct` lives) filtered to the Bayside Millworks org and this project by name, confirm there's exactly one row, and what its actual stored value is.
2. If there are duplicates, check whether `scripts/seed-demo-completed-projects.mjs` and/or `scripts/reset-org-data.mjs` are fully idempotent for this table, this script has explicit self-checks for the margin bands and the alert window, but that doesn't guarantee old rows get cleared on a re-run.
3. If there's only one row and its value is genuinely correct, the bug is somewhere between the DB and `page.tsx` I haven't found, worth a breakpoint on `completedProjects` state right after `setCompletedProjects(...)` to see the actual value React is holding for this project at render time.

## Why this matters beyond the marketing screenshot

This is a real bug in `/reports`, not just a demo-data issue, if it can happen to seeded data it can happen to a real shop's real completed project. Worth fixing at the source rather than just re-seeding around it.
