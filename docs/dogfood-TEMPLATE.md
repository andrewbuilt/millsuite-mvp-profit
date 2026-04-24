# Dogfood — `<project-slug>`

> **How to use this template:** copy to `docs/dogfood-<project-slug>.md` and fill in as you price a real customer estimate end-to-end. This is the Phase 12 Item 11 close-out gate — the numbers must come from a real job, not a click-through.

**Project:** `<Project name>`
**Client:** `<Client name>`
**Estimator:** `<Who ran it>`
**Date run:** `<YYYY-MM-DD>`
**Commit at time of run:** `<git rev-parse --short HEAD>`
**Time from open to first saved line:** `<hh:mm>`
**Total time end-to-end:** `<hh:mm>`

---

## Setup state at start

- [ ] Logged in as a user with `users.onboarded_at = NULL` (fresh org) — OR — an existing org re-running to test propagation. Which: `<fresh | existing>`
- [ ] Migrations 022–026 applied in Supabase (`select count(*) from rate_book_finish_breakdown`, `select application from rate_book_items limit 1`, `select * from onboarding_progress` should fail).
- [ ] `orgs.shop_rate` before this run: `$<X>/hr`

---

## 1. Welcome overlay (dark mode)

- [ ] Overlay gates the app on cold boot (all routes behind it).
- [ ] Start setup advances to the shop-rate walkthrough.

**Notes:** `<anything off>`

---

## 2. Shop rate walkthrough (4 screens, first-principles)

### Overhead screen
- Categories entered: `<list with $ and monthly|annual>`
- Annual overhead total: `$<Y>`
- [ ] Removing a row works.
- [ ] Renaming a row works.
- [ ] Adding a custom row works.

### Team screen
- Team members entered (name · annual comp · billable?): `<list>`
- Annual team comp: `$<Z>`
- Billable count: `<N>`
- [ ] Flipping billable=No on a row drops them from the billable-hours denominator.
- [ ] Owner salary + office staff go in here with billable=No (no double-counting via Overhead).

### Billable-hours screen
- Inputs: `<hrs/wk>`, `<wks/yr>`, `<util %>`
- Derived billable hours/yr: `<H>`

### Result screen
- Derived rate: `$<D>/hr`
- Did you override? If so → why + value: `<yes/no + $X/hr>`
- Final `orgs.shop_rate` written: `$<F>/hr`

### Shop-rate propagation test
- Open any already-saved subproject. Labor $ before the rate change: `$<A>`
- Change `orgs.shop_rate` directly in the DB to something different (or re-run walkthrough and pick a different override).
- Reload the same subproject. Labor $ after: `$<B>`
- [ ] Live labor recompute flows through (no stale banner needed — labor is live).

**Notes:** `<anything off>`

---

## 3. Base cabinet walkthrough (9 ops × 9 screens)

- [ ] Opener → How-it-works → 9 op screens → Summary.
- Values entered (for one 8' run, hours): `<list by op>`
- Per-LF derived (eng/cnc/assembly/finish): `<four numbers>`
- [ ] Summary table is editable; Save writes to `rate_book_items` "Base cabinet".

**Notes:** `<anything off>`

---

## 4. First composer line (Base cabinet)

Project subproject: `<Subproject name>`
- Product: Base
- Qty: `<X>` LF
- Slots picked:
  - Carcass material: `<name>` (`$<cost>/sheet`)
  - Door style: `<name>` — **calibrated at pick time?** `<yes | walkthrough fired>`
  - Door/drawer material: `<name>` (`$<cost>/sheet`)
  - Interior finish: `<Prefinished | name>`
  - Exterior finish: `<name>` — **calibrated for Base?** `<yes | walkthrough fired>`
  - End panels: `<n>`
  - Filler/scribes: `<n>`

### Breakdown vs prototype
Open `specs/add-line-composer/index.html` in a browser. Feed the same slots + same shop rate. Compare:

| Row | App $ | Prototype $ | Delta |
|---|---|---|---|
| Carcass labor | | | |
| Carcass material | | | |
| Door labor | | | |
| Door/drawer material | | | |
| Interior finish | | | |
| Exterior finish | | | |
| End panels | | | |
| Filler/scribes | | | |
| Consumables | | | |
| Waste | | | |
| **Line total** | | | |

**Match? If not, why:** `<notes>`

---

## 5. Door walkthrough fire-in-context

- [ ] Picking an uncalibrated door style from the composer dropdown fires `DoorStyleWalkthrough`.
- [ ] After save, the walkthrough closes and the picked style is selected on the line.
- [ ] "+ Add new door style" in the dropdown opens the walkthrough with a name prompt.

**Notes:** `<anything off>`

---

## 6. Finish walkthrough partial-calibration

- [ ] "+ Calibrate interior finish" opens `FinishWalkthrough` with header "Interior finish calibration".
- [ ] Calibrate only Base 8' on one combo. Save. Close.
- [ ] Composer line on a Base product using that finish works; the same finish on an Upper line surfaces a "not calibrated for upper" warning in the breakdown.
- [ ] Go back into the walkthrough, calibrate Upper 8'. The warning clears.
- [ ] Exterior dropdown is independent — same combo name can exist as an interior row and an exterior row, distinct labor/material.

### Duplicate for other application
- [ ] From the Interior walkthrough, click "Duplicate as Exterior" → confirmation appears.
- [ ] Close. Open Exterior walkthrough. The 4 combo rows are there, empty, ready to calibrate.

**Notes:** `<anything off>`

---

## 7. Second composer line (Upper) — product multiplier sanity

- Product: Upper
- Qty: `<X>` LF
- Door style: same as Base line (so multiplier is the only var).
- App door labor per LF: `<$>` — expected = Base door labor per LF × 1.3. Match? `<yes/no>`

## 8. Third composer line (Full)

- Product: Full
- Qty: `<X>` LF
- App door labor per LF: `<$>` — expected = Base door labor per LF × 2.5. Match? `<yes/no>`

---

## 9. Install prefill

- Subproject: `<Install or name>`
- Guys / Days / Complexity %: `<g>` / `<d>` / `<c>`
- Shop install rate (= `orgs.shop_rate`): `$<F>/hr`
- Expected: `g × d × 8 × F × (1 + c/100) = $<N>`
- App displays: `$<N_app>`
- Match? `<yes/no>`

---

## 10. Per-line staleness

- [ ] Save a composer line.
- [ ] Re-run the BaseCabinet walkthrough with different hours → save.
- [ ] Return to the subproject. Amber banner appears: "Rates have changed…"
- [ ] Click "Update to latest rates" → banner clears, line recomputes, totals reflect new numbers.
- [ ] Advance project stage to `sold`. Reload. Banner hides (post-sold lock).

---

## 11. Project total sanity

- Sum of line totals across all composer subprojects: `$<S1>`
- Plus install prefills across subs: `$<S2>`
- Project total in the cover: `$<S3>` — should equal `S1 + S2`. Match? `<yes/no>`

Compared to your spreadsheet / prior estimate for this job: `$<spreadsheet>` — delta: `<±$ / ±%>`. Reasonable? `<yes/no + why>`

---

## Issues found (severity · file · note)

1. `<severity>` · `<file>` · `<what broke / what felt wrong>`
2. `<...>`

## Nice-to-haves surfaced (not blockers)

1. `<...>`

## Numbers I don't trust / need a second look

1. `<...>`

---

## Close-out

- [ ] All 11 sections above have entries (or N/A).
- [ ] Any severity-high issue in the "Issues found" list has a ticket or commit link.
- [ ] BUILD-ORDER.md Phase 12 Item 11 checked off with a link to this file.

**Phase 12 close-out commit:** `<sha + date>`
