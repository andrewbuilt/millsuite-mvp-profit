# Brief: redesign the Completed Projects margin chart to a zero-baseline diverging bar

## ✅ BUILT 2026-09-16 — final shape: ZERO AT LEFT, DOLLARS, LADDERED AXIS.

Three versions were built and two were thrown away. The discarded ones are
recorded because each failed in a way that was invisible in code and obvious on
a rendered page, and the next person to touch this will be tempted by both.

**v1 — dollar profit, diverging off a data-positioned 0 line.** Fixed the
brief's stated problem (a loss no longer drew like a profit) and introduced a
new one: **the bar disagreed with the number beside it.** Gulfview drew the
longest bar in the set at **+31.9%** while Vega drew shorter at **+35.3%**,
because Gulfview is a bigger job. Andrew: *"I didnt consider the value just the
percentage."*

**v2 — margin percent on a fixed −100…0…+100 axis, 0 centred.** Bar and number
agreed, and the target tick came back as one line down the whole chart. But it
threw away job size entirely: a $500k job and a $3k job at the same margin drew
identically. Andrew: *"the original graph works because is money not percent."*

**v3 — SHIPPED. Zero at the far left, every bar grows right, length is dollars,
losses solid red, laddered axis with gradations, and the shop-level figures
moved onto the card.** Andrew: *"zero can to the far left. negative would just
be red. i think we need to add some gradations on the top up to $100k?
otherwise the scale would need to resize to accomidate larger and small
values."* Then: *"make the bar solid red not striped / remove the average
section at the bottom and replace it with the total profit and avg margin so
they're all on the same card."*

### ⚠️ What v3 knowingly gives up — read before "fixing" it

**A loss and a gain of the same size are the same length.** −$3,190 draws like
+$3,190. That is the exact misread this brief was written to kill ("losses and
gains need to be visually distinguishable by more than color alone"), and it is
back on purpose: on a dollar axis, length answers *how much money moved* and
direction is carried by fill.

⚠️ **The fill is now the ONLY thing carrying it, and the fill is hue alone.**
Losses were briefly striped as well; Andrew's call was solid red. Red/green is
the worst possible pair for colour-vision deficiency (~8% of men) and this chart
is going on a marketing site, so the only surviving non-colour cue is the minus
sign on the figure at the end of the row. ⛔ **If this chart ever has to survive
greyscale printing, or a reader with red-green CVD, the bar is not enough and a
pattern or an explicit label has to come back.** Noted, not silently accepted.

### The Average row is gone; the card carries the shop-level figures instead

"Total profit" and "Avg margin" used to be two free-floating `KpiCard`s **above**
the chart, fed by their own arithmetic on the page. That separation is precisely
how the page came to show **23.8% amber up top against a 28.7% green summary row
below it** — same seven jobs, two containers, opposite verdicts. They now render
inside `CompletedProjects`, derived from the same `projects` array the bars are
drawn from. ⛔ **Do not put a shop-level figure back on the page without
deriving it from that same array.**

### The axis is a ladder, not a cap and not a fit

$10k / $25k / $50k / $100k / $250k / $500k / $1M / $2.5M / $5M / $10M — smallest
rung that contains the data, chosen on the **absolute** value so a −$400k job
widens it too. Past the top rung it rounds up rather than clipping.

- A hard $100k ceiling would **clip** a job that made $150k, and a clipped bar
  reads as "exactly the maximum" — a plausible wrong number.
- An axis fitted to the data makes the best row always look maximal, so a shop
  having a terrible year renders exactly like one having a great year, and the
  scale twitches every time a project closes.
- The ladder is stable, can't clip, and the **gradations say the scale out
  loud** — which is what makes it safe for the axis to move at all.

### ⛔ The "Avg margin" KPI card above the chart changed too

It averaged the per-job *percentages*; the Average row is *blended*. On the real
demo set those are **23.8% and 28.7% — 4.9 points apart and on opposite sides of
the 25% target.** The page would have shown "Avg margin 23.8%" in amber (missed)
directly above an Average row reading 28.7% in green (beat), from the same seven
jobs. Two numbers is a discrepancy; two opposite verdicts in two colours is the
page arguing with itself. The card is blended now, which also agrees with the
"Total profit" card beside it: same numerator, over the revenue that made it.

### Also found while measuring

**The right-hand value column still had the bar-width bug** — `min-w-[70px]`,
and `-$3,190` is one character wider than `$6,480`, so the demo set was already
drawing on two different track widths. The previous day's alignment fix had only
got half of it. All three columns are fixed-width constants in one place now,
and the verify script fails on any `min-w-*` in the file.

**Files:** `lib/reports/margin-bar-geometry.ts` (pure),
`scripts/verify-margin-bar-geometry.mjs` (105 checks, math + layout, every one
break-tested), `scripts/preview-completed-chart.mjs` (renders the chart to
standalone HTML — **every visual defect across all three versions was found
this way and none was visible in the code**).

**Not done, still open:** the marketing reshoot (below).

---

**For:** Claude Code, on `main`.
**Why:** `docs/bug-completed-projects-bar-width.md` flagged a real problem after the alignment bug fix: `Math.abs(project.marginPct)` means a loss draws a bar the same way a profit does, distinguished only by color. On a chart that's about to anchor the marketing site's proof section, and that any real shop will see the first time a job loses money, that's a genuine misread, not just cosmetics. Andrew sketched the fix directly (see attached mockup, 2026-09-16): a zero-baseline diverging bar. This brief specs it out.

## What changes in `app/(app)/reports/components/CompletedProjects.tsx`

**Layout:** a fixed vertical "0 line" sits at a constant horizontal position in the row (not data-dependent, same x for every row so they stay comparable, this is the same alignment lesson from the bar-width bug, don't reintroduce an elastic column). Losses draw a bar extending **left** from the 0 line in red. Gains draw a bar extending **right** from the 0 line in the existing green (`#059669`, matches `marginBarColor`'s current "at or above target" color, don't invent a new green). A small legend row above the list: "Amount lost" (left, red), "0 line" (center), "Amount gained" (right, green).

**Bar length is driven by dollar profit (`project.profit`), not margin percentage.** This is the other half of the fix, percentage was never comparable across jobs of very different contract sizes anyway. Scale each bar against the max absolute `profit` value across the visible set (same pattern as the current `maxMargin` denominator, just swap the field). The percentage and dollar amount still render as text on the right, unchanged, that part already works.

**Add an "Average" row** below the list (Andrew's mockup includes this), same diverging-bar visual, showing the blended/average rate across all shown projects. Caption: "Average shows a visual of the blended rate." This gives a portfolio-level read in the same visual language as the individual rows.

**Keep:** the existing name/date column, the est/actual hours column (now fixed-width per the alignment bug fix, don't regress that), the percentage + dollar text on the right, the `transition-colors`-only rule from the previous fix (color can animate, length can't, per that same doc).

## What this replaces

The current single-direction bar (`Math.abs(marginPct)` scaled 0 to `maxMargin`, drawn left-to-right regardless of sign) goes away entirely in favor of the diverging version. Don't keep both, the whole point is losses and gains need to be visually distinguishable by more than color alone.

## Reference

Andrew's mockup (shared in chat 2026-09-16) shows the intended look: dark red bars extending left for the one loss (Meridian Storefront, −15.0%, −$3,190), dark green bars extending right scaled by dollar profit for the six gains, a centered "0 line," and an "Average" row at the bottom in the same style. Colors in the mockup are approximate/sketch-quality, use the product's actual token colors from `marginBarColor` (`#059669` green, `#DC2626` red, `#D97706` amber for the within-5%-below-target case if that state applies to a diverging bar) rather than matching the mockup's exact hex values.

## After this ships

The marketing site's "Real job" proof section screenshot (currently using the aligned-but-not-yet-diverging version) needs to be retaken once this redesign is live, hand back to Cowork for the reshoot and re-crop.
