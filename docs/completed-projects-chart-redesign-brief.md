# Brief: redesign the Completed Projects margin chart to a zero-baseline diverging bar

## ✅ BUILT 2026-09-16. ⛔ THE AXIS IS FIXED PERCENT, NOT DOLLARS — read this first.

**Shipped:** diverging bar off a **centred** 0 line, on a **fixed −100% … 0 …
+100% axis**, length driven by **the same `marginPct` that is printed in the
row**. Average row, legend, and the **target tick is back** as one vertical
line down the whole chart. `lib/reports/margin-bar-geometry.ts` (pure) +
`scripts/verify-margin-bar-geometry.mjs` (76 checks, math *and* layout).

### ⛔ The brief's "bar length = dollar profit" was built, then reversed.

Andrew, on seeing it: *"the percentages need to use the same scale to drive the
idea home. if its centered and each side of the totals to 100% it should show
the truth."* He was right, and the reason is visible in the dollar version's own
screenshot: **Gulfview drew the LONGEST bar in the set at +31.9%, while Vega
drew shorter at +35.3%** — because Gulfview is a bigger job. A longer bar
sitting next to a smaller percentage is unreadable, and it is the same class of
defect as the bar-width bug that preceded this whole redesign: **the drawing
disagreeing with the number beside it.**

So the bar is now the printed percentage, on an absolute scale. Dollars did not
disappear — they are under every percentage and on the Average row. They just
don't drive length any more, because length has to mean what the number means.

**What the fixed axis costs, deliberately:** bars no longer stretch to fill the
track. A 30% job fills 30% of its half. Nothing ever reaches either end. That
is the point — **a data-relative scale always makes the best row look maximal,
so a shop having a terrible year renders exactly like a shop having a great
one, and the chart can never say "this is bad."**

**What it buys back: the target tick.** It had to be deleted on a dollar axis
(25% of $21,300 is $5,325 and 25% of $102,500 is $25,625 — one "target" would
have sat in a different place on every row). On a percentage axis it's a single
line down the chart, and every row reads instantly as left of it or right of
it. Bayshore at +20.6% visibly stops short; everything else crosses.

⚠️ **100% is a real ceiling on the gain side** (margin = profit ÷ revenue, cost
≥ 0). **It is not a real floor on the loss side** — a job costing 3× its price
is −200%. Those clamp to the end of the track and the printed number keeps
telling the truth. Rare, and better than rescaling the chart around one
disaster.

### ⛔ The "Avg margin" KPI card above the chart had to change too.

It averaged the per-job *percentages*; the Average row is *blended*. On the real
demo set those are **23.8% and 28.7% — 4.9 points apart and on opposite sides of
the 25% target.** The page would have shown "Avg margin 23.8%" in amber (missed)
directly above an Average row reading 28.7% in green (beat), from the same seven
jobs. Two numbers is a discrepancy; two opposite verdicts in two colours is the
page arguing with itself, on the screen about to be used for marketing. The card
is blended now (`sub` reads "Blended · target 25%"), which is also what agrees
with the "Total profit" card beside it: same numerator, over the revenue that
made it.

### Also found while measuring

**The right-hand value column still had the bar-width bug** — `min-w-[70px]`,
and `-$3,190` is one character wider than `$6,480`, so the demo set was already
drawing on two different track widths. The alignment fix the day before had only
got half of it. All three columns are now fixed-width constants in one place,
and the verify script fails on any `min-w-*` in the file.

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
