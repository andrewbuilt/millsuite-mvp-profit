# Bug: Completed Projects margin bar wrong width for one row

**Found:** 2026-09-16, while pulling marketing screenshots from the Bayside Millworks demo org (Reports → Completed Projects).
**Investigated:** 2026-09-16. **The leading hypothesis below was wrong.** Findings at the bottom.

## Symptom (as reported)

On `/reports`, the "Completed projects" list shows 7 rows. "Sandpiper Lane Library Wall" (delivered Aug 28, 211h est / 213.5h actual) displays **+35.0%** and **$16,953**, correct text, matching its seed spec. But its margin bar renders dramatically short, roughly a fifth the length of "Vega Residence" right above it, which shows a near-identical +35.3% margin with a bar that runs nearly full length. Every other row's bar length looks proportionate to its displayed percentage. Only this one row is wrong.

## What was checked originally (all still correct)

- `CompletedProjects.tsx`: bar width is `(Math.abs(project.marginPct) / maxMargin) * 100`, and the percentage text renders from the same `project.marginPct`, same object, same render pass.
- `reports/page.tsx` line ~251: `marginPct: o.actual_margin_pct`, straight from the DB row, no client-side override.
- `scripts/seed-demo-completed-projects.mjs`: refuses to seed outside a hardcoded margin band.

## ✅ SOLVED — it was LAYOUT, not data. The bar was SHIFTED, not short.

Andrew's screenshot after a logout/login/refresh showed it clearly: Sandpiper's
bar is **not** a fifth the length. It starts **~24px to the right** of every
other row's bar and ends at roughly the same place, and **its target tick is
offset from the others too** — the rows are not aligned with each other.

**Cause:** the Hours column was `text-right min-w-[80px] … hidden sm:block`
with **no fixed width and no `flex-shrink-0`**, so it grew with its content and
the `flex-1` bar track beside it absorbed the difference.

**`213.5h actual` is two characters longer than `308h actual`.** Sandpiper Lane
is the only one of the seven rows whose hours carry a **decimal** — which is
exactly why it was the only row that looked wrong.

The consequence is worse than one odd row: every bar is drawn on a track of a
different width, so **bar lengths are not comparable between rows**, which is
the entire job of this chart. It reads as "one bar is wrong".

**Fix:** `w-[104px] flex-shrink-0` — wide enough for `9999.5h actual`. All
tracks now start and end at the same x, and the target ticks line up.

## The original hypothesis — DUPLICATE / ORPHANED OUTCOME ROWS — was wrong.

Queried the demo org (`36f655a7-…`) directly, replicating the page's own query
including its 90-day window and the practice-project filter:

```
rows in the 90d window: 7   maxMargin=35.3

Meridian Storefront Build-out       margin= -15 (number)  barWidth= 42.5%
Vega Residence — Painted Shaker     margin=35.3 (number)  barWidth=100.0%
Sandpiper Lane Library Wall         margin=  35 (number)  barWidth= 99.2%
Gulfview Kitchen — Rift Oak         margin=31.9 (number)  barWidth= 90.4%
Palm & Pine Salon — Reception Desk  margin=28.3 (number)  barWidth= 80.2%
Cypress Social — Bar & Banquette    margin=30.4 (number)  barWidth= 86.1%
Bayshore Closet System              margin=20.6 (number)  barWidth= 58.4%
```

**Exactly one outcome row per project. No duplicates, no orphans.** Every value
is a `number`, not a string. Sandpiper computes to **99.2%** and Vega to
**100%** — within one percent of each other, exactly as the text implies.

So: the stored data is right, the mapping is right, and the width formula is
right. Nothing between the database and the component can produce a fifth-length
bar for that row. **The symptom is not reproducible from the current state.**

⚠️ **The lesson for next time: the data was never the suspect to chase.** Both
the original investigation and the first pass of this one reasoned about where
`marginPct` could go wrong, because the symptom was described as a *length*.
The value was provably correct the whole time. The answer was visible in one
screenshot of the rendered page — the bars don't start in the same place — and
no amount of querying would have found it.

## Also changed (defensive, not the cause)

**`transition-all` → `transition-colors`** on the bar. `transition-all`
animates WIDTH, so for half a second after any data-changing re-render a bar is
a length that doesn't match its own number. On a page people screenshot and
read financially, an in-between width *is* a wrong number. Colour can animate;
length is data.

## ⚠️ Separate, real, and NOT fixed — a design call

`Math.abs(project.marginPct)` means **a loss draws a bar like a profit**.
Meridian at **−15%** renders a **42.5%-wide** bar — nearly half the track. A
−15% job and a +15% job draw *identical* lengths, distinguished only by colour.
On a chart where length reads as "how well did this go", that is a genuine
misread, and it will appear on any real shop's page the first time a job loses
money.

Not changed unilaterally: it alters a chart that is about to be used for
marketing screenshots, and the right treatment (zero baseline with losses
extending left? losses pinned to a short stub? length by profit dollars rather
than percent?) is Andrew's call, not a silent refactor.

## Why this matters beyond the marketing screenshot

Still true. The value path is now verified end to end for this page, and the
width can no longer animate away from its number. The negative-margin length
above is the remaining way this chart can mislead.
