# Bug: Completed Projects margin bar wrong width for one row

**Found:** 2026-09-16, while pulling marketing screenshots from the Bayside Millworks demo org (Reports → Completed Projects).
**Investigated:** 2026-09-16. **The leading hypothesis below was wrong.** Findings at the bottom.

## Symptom (as reported)

On `/reports`, the "Completed projects" list shows 7 rows. "Sandpiper Lane Library Wall" (delivered Aug 28, 211h est / 213.5h actual) displays **+35.0%** and **$16,953**, correct text, matching its seed spec. But its margin bar renders dramatically short, roughly a fifth the length of "Vega Residence" right above it, which shows a near-identical +35.3% margin with a bar that runs nearly full length. Every other row's bar length looks proportionate to its displayed percentage. Only this one row is wrong.

## What was checked originally (all still correct)

- `CompletedProjects.tsx`: bar width is `(Math.abs(project.marginPct) / maxMargin) * 100`, and the percentage text renders from the same `project.marginPct`, same object, same render pass.
- `reports/page.tsx` line ~251: `marginPct: o.actual_margin_pct`, straight from the DB row, no client-side override.
- `scripts/seed-demo-completed-projects.mjs`: refuses to seed outside a hardcoded margin band.

## ⛔ The hypothesis was DUPLICATE / ORPHANED OUTCOME ROWS. It is disproven.

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

Two explanations survive:

1. **The screenshot predates a corrected re-seed.** The doc itself notes the
   seed script "looks like it was iterated on". If an earlier pass wrote a bad
   `actual_margin_pct` and a later pass corrected it, the observation was real
   when made and is now fixed. "Persists after a hard refresh" doesn't
   distinguish this — every refresh before the re-seed would show it.
2. **A mid-animation paint.** The bar carried `transition-all duration-500`,
   which animates WIDTH. For half a second after any re-render that changes the
   data, a bar is a length that doesn't match its own number.

## What was changed

**`transition-all` → `transition-colors`** on the bar. Colour can animate;
length is data. On a page people screenshot and read financially, an in-between
width *is* a wrong number, and this was the only remaining mechanism by which a
bar could disagree with the percentage printed beside it.

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
