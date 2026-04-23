# Base Cabinet Walkthrough — Approved Spec

> **⚠ V1 status: DEFERRED.** The 9-step build-order flow below is not what
> V1 ships. Phase 12 item 4 delivers a small embeddable component —
> **five inputs** (Eng / CNC / Machining / Assembly / Finish) with
> machining folding into Assembly on save, four per-LF dept values
> written to the org's "Base cabinet" `rate_book_item`. See
> `BUILD-ORDER.md` Phase 12 item 4 and
> `components/walkthroughs/BaseCabinetWalkthrough.tsx` for the V1 path.
>
> Two open questions this spec needs to answer before it can ship as
> the richer V2 walkthrough:
>
> 1. **Doors inside the base-cab walkthrough vs. separate.** Steps 5–7
>    (cut doors, edgeband doors, machine hinge cups) calibrate door
>    labor on an 8′ run. V1's `DoorStyleWalkthrough` (Phase 12 item 7)
>    calibrates doors separately against 4 doors × 24″×30″ and
>    multiplies into Upper/Full via the product multipliers. If both
>    walkthroughs save labor, the composer double-counts door time
>    unless one replaces the other or the 9-step flow is trimmed.
>
> 2. **Dept-bucket aggregation rule.** The 9-step flow stores per-op
>    hours + a derived per-dept total; the V1 schema only stores per-
>    dept per-LF on `rate_book_items.base_labor_hours_*`. Either the
>    9-step spec keeps the per-op captures in a new table (for audit)
>    and derives dept totals on save, or it folds to dept-level only.
>
> Copy polish from this spec (input labels + help text) is already
> borrowed into the V1 component per explicit approval.

**Status:** Approved for build · 2026-04-22
**Owner:** Andrew
**Related plan:** [`docs/ONBOARDING-PLAN.md`](../../docs/ONBOARDING-PLAN.md)

This folder holds the approved clickable spec for the **base cabinet calibration walkthrough** — one piece of the new onboarding flow.

## What to open

- **`index.html`** — the clickable wireframe. Open in a browser. Full flow: setup selector → base-cabinet opener → how-it-works → 9 questions → summary. No backend; state is in-memory.

## What this is

The walkthrough replaces step 3 of the existing onboarding mockup. A new shop runs through it once and their base-cabinet per-LF labor rate is calibrated to how their shop actually works.

Framing: **"How long does it take to X in your shop?"** — asked across 9 operations in real build order.

## The 9 steps

| # | Step | Dept |
|---|---|---|
| 1 | Shop drawings + CNC program | Engineering |
| 2 | Cut interior parts (bottom, sides, dividers, nailers, adjustable shelves) | CNC |
| 3 | Edgebanding (interior parts) | Assembly |
| 4 | Box assembly | Assembly |
| 5 | Cut doors (veneer slab, 8' run) | CNC |
| 6 | Edgeband doors | Assembly |
| 7 | Machine hinge cups | CNC |
| 8 | Finish (prep + clear matte lacquer, sanded between coats) | Finish |
| 9 | Full assembly (hinge plates, shelf pin sleeves, mount doors, wrap) | Assembly |

## Interaction rules (for the build)

- **Input:** number only, `step="0.25"`, `min="0"`. Quarter-hour decimal or whole hours. No minutes, no `1:30`, no `1h 30m` formats.
- **Stepper:** `−` / `+` buttons adjust by 0.25 hr.
- **Skip** on every step — records as skipped (not 0) so the rate-book seed knows to omit it.
- **Back** doesn't discard the current input — soft-saves before navigating.
- **Walkthrough map sidebar** — jump-to-any-step, live running total at bottom.
- **Sanity banner** on the summary uses these thresholds: total < 3 hrs → low-warning, total > 22 hrs → high-warning, else in-range.

## Output contract

After the walkthrough the system persists:
- `answers[op_id] = { hours: number | null, skipped: boolean }` for each of the 9 operations
- `derived.per_lf_hours_by_dept = { Engineering, CNC, Assembly, Finish }` — total-by-dept ÷ 8
- `derived.per_lf_labor_cost` — sum of (per_lf_hours_by_dept[d] × shop_rates[d])

These values seed the rate-book's base-carcass line items. Extrapolation multipliers for other setups (uppers, tall, etc.) run separately — each setup is its own walkthrough on the selector screen.

## Setups on the selector screen

Only **Base cabinets** is active in V1. The other five tiles (Upper cabinets, Full-height, Finish panels, Shop kick, Drawers) render as "Later" placeholders.

## Build target

Next.js route: `app/(app)/onboarding/base-cabinet-calibration/page.tsx`
Data persistence: new `rate_book_calibration` table, keyed by (`org_id`, `setup_type`).
Shop rates come from the existing onboarding step 2 (`orgs.shop_rate` / per-dept rates).
