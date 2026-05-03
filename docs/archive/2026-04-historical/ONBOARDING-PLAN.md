# Guided Onboarding Plan — Process-Based Calibration

**Status:** ⚠️ HISTORICAL — superseded 2026-04-24
**Owner:** Andrew
**Last updated:** 2026-04-22

> **This document is the design trail that led to the current first-run flow, not a description of what's currently built.** For ground truth on the first-run experience, read:
>
> - `BUILD-ORDER.md` — Phase 11 (collapsed) + Phase 12 Items 5 and 12
> - `specs/add-line-composer/README.md` — the "Onboarding surface" section
> - `SYSTEM-MAP.md` — section 1, "First-run state (welcome overlay + starter rate book)"
>
> **Known stale points in this doc:**
>
> - The "6 existing onboarding steps" (business card / past estimate / bank statement / dept-rate sliders / connect tools / summary) were retired. The active first-run flow is just welcome → shop-rate walkthrough → base-cabinet walkthrough, running inside `WelcomeOverlay`.
> - Per-department shop rates ("dept rates") are superseded by a single blended `orgs.shop_rate` derived from overhead + team comp / billable hours (Phase 12 Item 12).
> - References to "Phase 11" onboarding should be read as retired scope; the process-based walkthrough this document advocates for lives in Phase 12 as the base-cabinet walkthrough, and the shop-rate walkthrough is the first-principles flow, not a dept-rate slider set.
>
> Kept for archive so the reasoning behind the current design stays recoverable. Do not treat anything below as current spec.

This doc persists across threads. When a new thread picks this up, read this first, then scan the **Phase checklist** at the bottom to see where we are.

---

## The core idea

A new user logs in. Instead of handing them a blank rate book or asking three multiple-choice questions to scale a starter library (which is what the current `onboarding-mockup.html` step 3 does), we walk them through pricing **one canonical cabinet** — an 8-ft run of base cabinets with a veneer slab door — by asking how long *each operation in their shop* takes.

A shop with a CNC answers "1 hour" for cutting. A shop with a panel saw answers "4 hours." A shop with an edge bander answers "30 minutes" for edgebanding; without one, "6 hours." Their answers become their rate book's per-department hours, calibrated to their actual tools and process.

This is the opposite of template-fitting. The rate book emerges from the shop, not the other way around.

### Why this is better than the current step 3

- **Concrete anchor.** Humans reason about a specific 8-ft cabinet more confidently than abstract "hours per LF."
- **Teaching moment.** Walking the sequence (cut → edgeband → assemble → finish → install) teaches how MillSuite decomposes cost. The user understands the estimate because they built the numbers.
- **Self-calibrating to shop reality.** Tool ownership, crew skill, and process speed all show up in the answers.
- **First principles, not percentile fit.** "Fast / Standard / Thorough" pushes everyone toward the middle. Operation-by-operation lets any shop arrive at their actual numbers.

---

## V1 scope (decided 2026-04-22)

**In V1:**
- Process-based labor calibration (the 8-ft cabinet walkthrough)
- Shop setup (name, structure, departments, dept rates) — integrates with existing `onboarding-mockup.html` steps 1–2
- Extrapolation from single anchor to full rate book via published multipliers

**Not in V1 (later phases):**
- Standard products (door styles, drawer systems) — guided Q&A or learned from repeat usage
- "Best practices / how the site works" tour — will be inline explanation in V1, standalone module later
- Material catalog (plywood cores, veneer qualities) — project-by-project for now; repeat-material detection comes later
- Employee list / per-person time tracking

## Relationship to existing onboarding (decided 2026-04-22)

Keep existing steps 1, 2, 4, 5, 6. **Replace step 3** — the current 3-question calibration — with the new process-based walkthrough.

Existing flow reference:

```
Step 1 — Welcome (shop name, work type, crew size)     [KEEP]
Step 2 — Shop rate ($/hr, single or per-dept)          [KEEP]
Step 3 — Starter library calibration (3 MC questions)  [REPLACE ← this plan]
Step 4 — Connect tools (QBO, Drive, Harvest)           [KEEP, optional]
Step 5 — First estimate (paths forward)                [KEEP]
Step 6 — Summary + learning loop intro                 [KEEP]
```

## Anchor strategy (decided 2026-04-22)

**Single anchor: 8-ft base cabinet run with a veneer slab door.**

The walkthrough produces per-dept hours for:
- Base carcass (per LF)
- Veneer slab door (per unit)

Every other rate book item is derived via **extrapolation multipliers** shown transparently and tunable by the user (see below).

Rationale: one walkthrough respects the user's time. The multipliers expose the derivation so the user can tune any item that feels off. Opens the door (pun intended) to just-in-time calibration for new item types later.

---

## Setup-walkthroughs framing (locked 2026-04-22 r2)

The onboarding step isn't one monolithic cabinet flow — it's a **menu of setup walkthroughs**, each calibrating one category. V1 lights up **Base cabinets**; the others are scaffolded but not functional yet.

**The menu:**

- **Base cabinets** — 8' run, veneered slab doors, matte clear finish *(V1 active)*
- **Upper cabinets** — if different from base
- **Full-height cabinets** — pantries, built-ins, tall storage
- **Finish panels** — end panels, fillers, applied moldings
- **Shop kick** — if the shop builds their own instead of using legs
- **Drawers** — boxes + fronts

Selector screen is the entry point. User clicks Base cabinets, runs that walkthrough, returns to selector. Repeat for each setup they need.

## Base-cabinet walkthrough — operation sequence (locked r2)

9 steps. Minimal copy per step — no lede, no help box. Opener covers the framing; each step is a single question following the pattern **"How long does it take to X in your shop?"**

| # | Step | Prompt | Feeds dept |
|---|---|---|---|
| 1 | Shop drawings + CNC program | *"How long does it take to draw up shop drawings and program the cuts for an 8' base run in your shop?"* | Engineering |
| 2 | Cut interior parts | *"How long does it take to cut the parts for an 8' run in your shop?"* | CNC |
| 3 | Edgeband interior | *"How long does it take to edgeband those parts in your shop?"* | **Assembly** |
| 4 | Box assembly | *"How long does it take to screw the boxes together in your shop?"* | Assembly |
| 5 | Cut doors | *"How long does it take to cut an 8' run of grain-matched veneer slab doors in your shop?"* | CNC |
| 6 | Edgeband doors | *"How long does it take to edgeband the doors in your shop?"* | **Assembly** |
| 7 | Machine hinge cups | *"How long does it take to machine the hinge cups in your shop?"* | CNC |
| 8 | Finish | *"How long does it take to prep and finish the doors (clear matte lacquer, sanded between coats) in your shop?"* | Finish |
| 9 | Full assembly | *"How long does it take to install shelf pins, shelves, hinges, and hang the cabinet in your shop?"* | Assembly |

Note: **Edgebanding is Assembly, not CNC** (Andrew's call — the bander lives in the assembly area, not the machining area). Engineering is one step combining shop drawings + CNC programming. No drawers, no feet, no kick, no install — those get their own walkthroughs.

## Opener copy (locked r2)

Screen shown after selector click, before how-it-works:

> **Let's run numbers on your base cabinets.**
>
> Every shop is different. Some have CNCs, some tracksaws. Some have edgebanders and some are ironing on banding. Let's dial in your specific labor hours.

## How-this-works copy (locked r2)

Screen shown after opener, before step 1:

> **How this works.**
>
> We're going to think through building an 8' cabinet with veneered doors and a matte clear finish. We'll walk you through each step and at the end we'll have some good baseline numbers to start cranking out estimates.

## UI behavior per step (locked r2)

- **One question per screen.** Short heading + single prompt. No lede paragraph, no help box.
- **Input:** number-only, quarter-hour increments (0.25 step). Whole numbers or decimals — **not** minutes, not mixed formats.
- **+/- stepper buttons** flanking the input for quick adjust.
- **Skip** button — records as skipped, auto-advances.
- **Back** works without losing what was typed.
- **Walkthrough map sidebar** — list of 9 steps, current highlighted, done steps checked, click-to-jump, running total at bottom.
- **No cabinet illustration.** Dropped in r2 — couldn't make a schematic that actually looked like a cabinet.

## Summary screen (locked r2)

- Total hours + cost (at shop rates from full onboarding step 2)
- Per-dept breakdown (Engineering / CNC / Assembly / Finish)
- Per-LF labor (total ÷ 8) — the headline number for downstream estimating
- Example extrapolation line: "A 12' base run = X hrs / $Y"
- Sanity banner (low / high / in-range)
- Edit table — every step editable or toggleable to skipped
- "Save and continue" → back to the setup selector so the user can pick the next walkthrough

---

## Extrapolation strategy

One walkthrough = hours for base carcass + slab door. The rest of the rate book is generated by publishing multipliers transparently. User can see the multiplier, tune it, or override the final hours per item.

**Proposed starter multipliers** (need validation, these are industry rule-of-thumb):

### Carcass extrapolation (from base carcass hrs/LF)

| Item | Multiplier on base | Rationale |
|---|---|---|
| Base carcass | 1.0× | anchor |
| Sink base (adj) | +0.2× base hrs, +material | plumbing cutouts, apron |
| Wall carcass | 0.75× base | shorter box, less depth |
| Tall/pantry carcass | 1.4× base per LF | taller, more parts, more finish |
| Island carcass | 1.1× base | extra end panels |

### Door extrapolation (from veneer slab door hrs/door)

| Item | Multiplier on slab door | Rationale |
|---|---|---|
| Slab door | 1.0× | anchor |
| Shaker door | 1.4× slab | 5-piece construction |
| 5-piece raised panel | 1.7× slab | raised panel CNC + sanding |
| Glass insert door | 0.9× slab on cut, +0.3 hr finish | less sanding, glazing |

### Drawer extrapolation

| Item | Multiplier | Rationale |
|---|---|---|
| Drawer box | from walkthrough step 9, split 50/50 box vs front | |
| Drawer front | matches door style × 0.6 | smaller than door |

### Trim / Panels / Hardware / Install

These either come directly from walkthrough answers (install, hardware) or are flat-rate items with material-only cost (pulls, knobs, trim materials).

**UI treatment:** the user sees the multiplier table as a "Derived rates" step after the walkthrough. Each row shows derivation math ("0.75× your base = X hrs/LF"). User can adjust any row. Over time, real job actuals refine these.

---

## Shop setup — what step 1 and 2 need to cover

Existing onboarding covers most of this. For V1, confirm these fields exist:

- Shop name
- Primary work type (custom millwork / kitchens / commercial / built-ins)
- Crew size (solo / small 2-5 / medium 6-15 / large 16+)
- Shop rate: single $/hr OR per-department rates
- Departments: **assume standard 5 — Engineering, CNC, Assembly, Finish, Install — in V1**. Shops without a CNC still use "CNC" as the department label; their hours there reflect panel-saw / manual time. Shop-specific dept naming is a V2 concern.

**Not in V1:**
- Employee list (who works where)
- Shift structure
- Vendor catalog
- Physical location / address

---

## Learning loop hooks (future phases)

The walkthrough answers seed the rate book. As the shop closes real jobs, the Phase 10 `item_suggestions` system (already scaffolded in migration 011) can propose rate adjustments.

Key integration points for later:
- After each closed kitchen, compare actual vs estimated hours by (sub, dept). Nudge the walkthrough-derived rates.
- When variance exceeds a threshold, offer to increase tracking fidelity (Andrew's staged-granularity idea from thread 2026-04-22).
- When a shop uses the same material 2+ times, offer to save it as a standard material variant.

These are out of scope for V1 onboarding but the calibration output must be structured so the learning loop can read and refine it.

---

## Open questions

1. **Door & drawer counts in the walkthrough default.** Is 3 boxes + 2 doors + 3 drawers the right default for an 8-ft base run? Affects how we divide per-run answers into per-unit rates.
2. **Is finish included in the walkthrough, or a separate mini-flow?** Finish varies wildly by finish system. Might warrant its own 3-question sub-flow inside the walkthrough.
3. **Install — 1 man or 2 men?** On-site install is usually 2 installers. Walkthrough question should specify.
4. **How to handle non-CNC shops.** Step 3 "Cut box parts" asks about CNC or panel saw. If a shop doesn't have a CNC, does their "CNC department" still exist conceptually? (Leaning yes — it's where machining time goes regardless of the machine.)
5. **Engineering time — does every shop have it?** Some one-person shops skip formal shop drawings. Walkthrough should accept 0 gracefully and still function.
6. **How do we show the output?** After the walkthrough, do we jump straight to step 4 (tool connections), or show a "Here's your rate book" confirmation view?

---

## Phase checklist

Work progresses top-down. Check items off as threads complete them.

### Phase 1 — Plan lock-in

- [x] Confirm V1 scope (labor calibration + shop setup)
- [x] Confirm relationship to existing onboarding (replace step 3)
- [x] Confirm anchor strategy (single 8-ft base cabinet with slab door)
- [x] Draft persistent plan doc (this file)
- [x] Lock 8-step operation sequence from Andrew's voice description (2026-04-22)
- [ ] Andrew sign-off on the extrapolation multipliers (deferred — not in the baby-step wireframe)
- [ ] Resolve remaining open questions as they come up

### Phase 2 — Prototype the guided cabinet tour ✅ COMPLETE

- [x] Build clickable HTML wireframe — setup selector → opener → how-it-works → 9 steps → summary
- [x] Number-only input in 0.25 increments; skip per step; back/edit navigation
- [x] Walkthrough map sidebar with jump-to-step and running total
- [x] Summary screen — total hrs, per-dept split, per-LF labor, 12' projection, edit-any-step table
- [x] Andrew review rounds (r1 → r2 reframe → r3 copy polish)
- [x] **Approved spec moved to `specs/base-cabinet-walkthrough/`** for engineering handoff

### Phase 3 — Integrate into full onboarding flow

- [ ] Update `mockups/onboarding-mockup.html` step 3 to use the new walkthrough
- [ ] End-to-end flow demo: welcome → rate → walkthrough → extrapolation preview → tools → first estimate

### Phase 4 — Implementation

- [ ] Schema: how walkthrough answers persist (org-level calibration record + rate_book_item_history entries)
- [ ] Code: walkthrough page at `app/(app)/onboarding/calibration/page.tsx`
- [ ] Code: extrapolation function in `lib/rate-book-calibration.ts`
- [ ] Update `lib/rate-book-seed.ts` to read calibration answers
- [ ] QA: run the flow with a brand-new org, verify rate book populates with real numbers

### Phase 5 — Later / V2

- [ ] Standard products flow (door styles, drawer systems — guided Q&A)
- [ ] Material catalog (plywood / veneer selector)
- [ ] Repeat-material learning ("you've used white oak twice — save as standard?")
- [ ] Just-in-time calibration (when user adds a new item type, offer mini-walkthrough)
- [ ] Employee / role setup
- [ ] Variance-triggered granularity upgrades (Andrew's staged-fidelity idea)

---

## Related files

- `mockups/onboarding-mockup.html` — current onboarding flow (step 3 will be replaced)
- `mockups/kitchen-wizard-mockup.html` — Kitchen Wizard prototype from prior thread (uses starter rate book)
- `lib/rate-book-seed.ts` — current starter library seeding logic
- `lib/estimate-lines.ts` — pricing math that consumes rate book
- `db/migrations/006_rate_book_phase1.sql` — rate book schema
- `db/migrations/011_item_suggestions_phase10.sql` — learning-loop schema
- `BUILD-ORDER.md` — phase-by-phase build plan (onboarding is Phase 11)
- `SYSTEM-MAP.md` — architectural overview

---

## Decision log

- **2026-04-22** — V1 scope set to labor calibration + shop setup. Standard products, material catalog, and best-practices tour deferred to later.
- **2026-04-22** — Replace step 3 of existing onboarding rather than build a new flow.
- **2026-04-22** — Single anchor: 8-ft base cabinet with veneer slab door. Extrapolation multipliers for everything else.
- **2026-04-22** — Locked 8-step operation sequence from Andrew's voice description. Dropped Engineering and Install steps from V1 walkthrough — focus is the cabinet itself; engineering and install will get separate calibration later. Also dropped drawers, feet, and kick from the walkthrough.
- **2026-04-22** — Tone requirement: conversational, human, personal. Not a checklist. Every step has a skip option. Every step editable after-the-fact.
- **2026-04-22 r2** — Reframe: onboarding is a **selector menu of setup walkthroughs** (base / uppers / full-height / panels / kick / drawers). V1 lights up Base only.
- **2026-04-22 r2** — Engineering re-added as step 1. Edgebanding (box + doors) moved from CNC to **Assembly**. Walkthrough now 9 steps.
- **2026-04-22 r2** — Input: number-only, 0.25 step. Dropped mixed-format parsing (minutes, `1:30`, `1h 30m`) — Andrew wants quarter-hour decimal or whole-number hours only.
- **2026-04-22 r2** — Dropped cabinet SVG illustration. Kept walkthrough map sidebar.
- **2026-04-22 r2** — Stripped per-step help copy and ledes. Opener + how-it-works screens carry the framing; each step is a bare question.
