# Brief: redesign the Completed Projects margin chart to a zero-baseline diverging bar

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
