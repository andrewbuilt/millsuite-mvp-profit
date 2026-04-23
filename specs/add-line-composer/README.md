# Add-a-line Composer — Prototype Spec

**Status:** Prototype for review · 2026-04-23
**Owner:** Andrew
**Related plans:**
- [`../base-cabinet-walkthrough/`](../base-cabinet-walkthrough/) — upstream calibration that populates the rate book
- [`../shop-rate-setup/`](../shop-rate-setup/) — upstream shop rate
- [`../../docs/ONBOARDING-PLAN.md`](../../docs/ONBOARDING-PLAN.md) — overall onboarding strategy

This folder holds the clickable prototype for **adding a pricing line to a subproject**. It's the load-bearing moment where a calibrated rate book turns into a real estimate the user can trust.

## What to open

- **`index.html`** — clickable wireframe. Open in a browser. In-memory state, no backend.

## Guiding principle — one unit of thinking: 8' run

Every walkthrough across the system calibrates against the same unit — **an 8 linear foot run**. Base walkthrough asks about 8' of base cabinets. Finish walkthroughs ask about 8' runs of base / upper / full. Door walkthroughs ask about **4 doors (24" × 30") — the doors that would populate an 8' run of base**. This keeps the user's mental model consistent and avoids "why are you asking per 5?" confusion.

## What it proves

Three things need to click for the whole onboarding-to-pricing loop to work:

1. **The user picks a product, not a component.** Six tiles (Base cabinet run, Upper run, Full height, Drawer, LED, Countertop). The line *is* the spec.
2. **The line composes from qualifier slots** (carcass material, door style, door/drawer material, interior finish, exterior finish, end panel count, filler/scribes count, notes), with **last-used carry-over per product** — whatever slots you picked last time for a Base run auto-fill the next Base run, across subprojects.
3. **New templates get added inline, without leaving the subproject.** Material add-new = small inline card (name + $/sheet). Door style add-new = guided walkthrough modal → saves per-door labor to the rate book → selects on the line.

## The product list (V1)

| Product | Unit | Height descriptor | Active in prototype |
|---|---|---|---|
| Base cabinet run | LF | 30" typical | ✅ Full composer wired |
| Upper cabinet run | LF | 42" or less | ✅ Full composer wired (1.3× door labor) |
| Full height run | LF | 96" or less | ✅ Full composer wired (2.5× door labor) |
| Drawer | each | — | Stub tile — later |
| LED | LF | — | Stub tile — later |
| Countertop | LF | — | Locked ("Later") |

**V1 launch scope:** Ship Base, Upper, and Full. Drawer, LED, Countertop come after the end-to-end pricing loop is proven in the wild — shop rate → walkthroughs → rate book → real lines on a real estimate. Resist building more product types until that loop is functioning.

User-created products are explicitly out of scope for V1 — the product list is hardcoded. Users can add unlimited templates *inside* slots (new door style, new exterior material, etc.).

**Units: LF across the board.** The system knows the box size that a linear foot implies (base is 30"×12", upper is 42" or less × 12", full height is 96" or less × 12") — that's how face-material math stays correct without asking the user for heights on every line. Heights live on drawings, not the estimate.

## Base cabinet run — slot schema

| Slot | Source | Notes |
|---|---|---|
| Quantity | user input | in LF |
| Carcass material | rate-book carcass templates | ~3 typical templates for most shops |
| Door style | rate-book door styles (labor blocks) | calibrated via door walkthrough |
| Door/drawer material | rate-book exterior templates | covers both doors and drawer fronts |
| Interior finish | rate-book finish blocks | usually "prefinished" — no finish labor |
| Exterior finish | rate-book finish blocks | applied to doors, drawer fronts, end panels |
| End panels | count | flat per-unit cost |
| Filler/scribes | count | flat per-unit cost |
| Notes | free text |

Drawers are **not** a slot on the base line — they're their own line. Drawer fronts are included in the base line's door/drawer material cost.

## Product dimensions (internal constants)

The product, not the material template, decides how much face sheet a LF consumes. These are baked into the product and used internally by the pricing math — the user never sees them.

| Product | Typical door size | Face sheets per LF | Doors per LF* | Door labor multiplier† |
|---|---|---|---|---|
| Base | 24" × 30" | 1 / 12 (0.083) | 0.5 | 1.0× |
| Upper | 24" × 42" | 1 / 8 (0.125) | 0.5 | 1.3× |
| Full height | 24" × 96" | 1 / 4 (0.25) | 0.5 | 2.5× |

*Doors-per-LF converts the calibrated per-door labor into a per-LF labor rate. Never displayed. An 8 LF run averages 4 doors of mixed widths and the numbers shake out.

†Door walkthroughs calibrate against 4 base-height doors (24"×30"). Uppers and full-height doors take proportionally longer — mostly surface-area-driven with some overhead. The multiplier scales the calibrated base-door labor when applied to upper or full lines. Adjustable later if shops want separate calibrations, but this covers the common case without forcing three walkthroughs per door style.

## Departments — four (hours only; single blended rate)

Walkthroughs capture labor across these four buckets for **hours** only. Any bucket can be zero. Labor $ uses a single blended `orgs.shop_rate` (Phase 12 item 12 — the per-department rate table was deprecated). Per-dept hours remain on the line for scheduling and time tracking.

| Department | Purpose |
|---|---|
| Engineering | drawing, cut-list, shop-prep time |
| CNC | machine programming + runtime |
| Assembly | carcass + hardware install (wood machining folds in here) |
| Finish | sanding, spray, cure, touch-up |

**"Wood machining" is not a separate department.** It's a *guided sub-step* inside the walkthroughs — the questions pull it out explicitly so users don't lump everything under "assembly" and under-report it, but the captured hours fold into the assembly bucket.

## Door walkthrough — 4 doors, 5 guided steps

Calibration unit: **4 doors at 24" × 30" (one 8' run of base)**. Five guided steps, one per work type. Any step can be zero.

| Step | Bucket | What to capture |
|---|---|---|
| 1. Engineering | → eng | CAD / layout. Often zero. |
| 2. CNC | → cnc | CNC time. Zero if cut by hand. |
| 3. Wood machining | → assembly | Jointer, planer, shaper, rails & stiles. Rolls into assembly. |
| 4. Assembly | → assembly | Glue-up, square, sand. |
| 5. Finish | → finish | Spray and flip. |

Each step's answer gets divided by 4 to yield per-door hours by bucket. `perDoor × 0.5 doors/LF` → per-LF labor for the style.

## Exterior finish — one walkthrough, collapsible combos, fill-as-you-go

Finish labor and material are calibrated **per product category** as **per-LF** rates — no SF math exposed or asked for. **One walkthrough contains every finish-on-style combo × cab height**, but the user doesn't have to fill out all of them. Each combo is a collapsible row. Expand the one you're working on, fill it out, save — and that calibration is live in the rate book. The others stay dormant until a future line needs them (at which point the composer surfaces them again via the walkthrough hatch).

Structure of the walkthrough:

- **Rows = finish-on-style combos** (e.g. "Stain + clear on slab", "Paint on shaker"). Prefinished is implicit — zero everywhere.
- **Each row expands to three cab-height cards**: Base 8' / Upper 8' / Full 8'. Any card can be left blank; blank means "haven't calibrated this yet" and a line that tries to use it shows an uncalibrated warning.
- **Each card captures**: labor hours for the 8' run (folds to per-LF on save) + material cost broken down by consumable (primer, paint, stain, lacquer — any can be zero).

| Finish combo | Base 8' card | Upper 8' card | Full 8' card |
|---|---|---|---|
| Stain + clear on slab | hrs + stain $ + lacquer $ | same fields | same fields |
| Paint on slab | hrs + primer $ + paint $ | same | same |
| Stain + clear on shaker | hrs + stain $ + lacquer $ | same | same |
| Paint on shaker | hrs + primer $ + paint $ | same | same |

The app stores per-LF numbers internally (divide the 8' answer by 8 on save) but asks the user in whole-8'-run terms to keep the mental model consistent. Each material breakdown stores independently so the rate book can surface "paint costs you $X/LF on slab uppers" rather than a single opaque finish-material number. **Critically, partial calibration is a supported state** — shops only build out the combos they actually sell, as they sell them.

## Seeded rate-book data in the prototype

The prototype seeds the rate book as if the user has completed Shop Rate Setup + the base-cabinet walkthrough + the finish walkthrough + the slab door walkthrough.

- **Carcass labor per LF**: `{ eng: 0.08, cnc: 0.25, assembly: 1.40, finish: 0.10 }`
- **Carcass materials**: Maple prefinished ply ($68/sht, 1.2 sht/LF), White prefinished ply ($58, 1.2), Baltic birch ($95, 1.2)
- **Exterior materials**: Paint-grade MDF ($42/sht), White oak veneer rift ($195/sht), Maple veneer rift ($185/sht) — sheets/LF derived from product
- **Door styles**: Slab (calibrated: per-door `eng 0.02 / cnc 0.12 / assembly 0.20 / finish 0.40`), Shaker (not calibrated — demonstrates the walkthrough hatch). Base multiplier applied for upper (1.3×) / full (2.5×) when the door goes on those products.
- **Finishes**: Prefinished, CV clear, Stain + clear, Paint — each with per-category per-LF calibration. Material cost in the prototype is a single number per category; V1 breaks it into primer/paint/stain/lacquer sub-items captured by the walkthrough.
- **Shop rate**: single blended rate from `orgs.shop_rate` (derived by the first-principles walkthrough — overhead + team comp / billable hours, Phase 12 item 12). Applied to every labor-hour bucket below.

## Line breakdown — the math

```
Labor (every dept priced at the single orgs.shop_rate)
  Carcass labor      = qty × Σ(dept hrs/LF) × shop_rate                            [4 depts, from base walkthrough]
  Door labor         = qty × doorsPerLf × product.doorLaborMultiplier × Σ(per-door dept hrs) × shop_rate   [scaled for upper/full]
  Interior finish    = qty × finish.byProduct[cat].laborHr × shop_rate             [0 when prefinished]
  Exterior finish    = qty × finish.byProduct[cat].laborHr × shop_rate
  End panels         = count × flat labor hours × shop_rate
  Filler/scribes     = count × flat labor hours × shop_rate

  (Install labor is per-job, outside the line composer. Also priced at shop_rate.)

Material subtotal
  Carcass material   = qty × sheetsPerLf × sheet cost                 [carcass template]
  Door/drawer mat.   = qty × product.sheetsPerLfFace × sheet cost     [face, product-driven]
  Interior finish    = qty × finish.byProduct[cat].material           [0 when prefinished]
  Exterior finish    = qty × finish.byProduct[cat].material
  End panels         = count × flat material
  Filler/scribes     = count × flat material

Consumables markup   = material subtotal × consumables%    [default 10%, editable on the line]
Waste markup         = material subtotal × waste%          [default 5%, editable on the line]

Line total = labor + material subtotal + consumables + waste
```

Consumables replaces any flat hardware line — it's a material-scaled markup covering glue, screws, sandpaper, standard hinges. Waste is a separate adjustable buffer. Both percentages are editable on the breakdown and carry forward subproject-wide.

## Interaction notes

- **Dropdown behavior:** click to open, click outside to close, click an item to select. Last option in a material dropdown is always "+ Add new material."
- **Inline add-new card:** replaces the dropdown space. For carcass materials: name + $/sheet + sheets/LF. For door/drawer (face) materials: just name + $/sheet — sheets per LF is derived from the product.
- **Door walkthrough modal:** triggered when selecting an uncalibrated door style or "+ Add new door style." 5 stubbed steps in the prototype (Eng / CNC / Machining / Assembly / Finish) asking hours for 4 doors at 24"×30". Completion folds machining into assembly, divides by 4 to get per-door, updates the rate book, selects on the line.
- **Live breakdown:** right rail shows labor/material per buildup row, updating as slots change. Consumables % and Waste % are editable number inputs on the breakdown itself. Warn row surfaces if the selected door style isn't calibrated yet.
- **Block on save:** clicking "Add line" while a required slot is uncalibrated shows a toast and blocks the save.
- **Defaults resolution order:**
  1. **Last used for this product** — whatever slots were saved on the most recent line of this product, regardless of subproject. Carries across the whole org.
  2. **Hard fallback** — first rate-book entry of each slot. Used for the very first line of a product type before any history exists.

## Install — subproject-level prefill, not a line item

Install labor lives at the subproject level, not inside the line composer. **Not in this prototype — lands in the actual build.** When a user opens the install section of a subproject, they see a simple prefill:

```
Install = (guys × days × shop install rate) × (1 + complexity markup %)
```

- **Guys**: number of installers on the job.
- **Days**: estimated days on site.
- **Shop install rate**: from Shop Rate Setup ($80 seeded). Changes there flow into the prefill automatically.
- **Complexity markup**: a single percentage input — works like a profit margin. Inline description lists the typical reasons you'd mark up: *elevator access, 2nd-floor with stairs, long carry, tight stairwell, historic building, occupied residence, etc.* One number, one decision, no checkbox matrix to maintain.

The subproject shows the computed install cost alongside its cabinet cost. Both roll up into the estimate total. This keeps install logic simple for V1 and out of the line composer's way, while still making it respond to shop-rate changes the same way cabinet labor does.

## What's not in the prototype

- **Other products** beyond Base. Tiles render as stubs.
- **Persistent state.** Everything resets on page reload. The real build persists to a `subproject_lines` table + the rate-book tables.
- **Per-project rates or per-line markup overrides.** Margin happens at the subproject level in the real data model; the prototype just shows raw cost.
- **Finish walkthrough.** Seeded as if already calibrated; V1 adds a single walkthrough covering finish-on-style combos × three cab heights, with primer/paint/stain/lacquer as separate material line items.
- **Install labor.** Captured per-job elsewhere in the subproject, not on the line. The line composer deliberately stops at cabinet cost.

## Build targets (when we're ready)

- Composer route: new React page mounted at the existing `app/(app)/projects/[id]/subprojects/[subId]/page.tsx`, replacing the current detail-panel UI for new lines.
- Product definitions: hardcoded constants in `lib/products.ts` — each product declares its slot schema and dimensions (`sheetsPerLfFace`, `doorsPerLf`, `doorLaborMultiplier`).
- Rate-book template tables: extend existing `rate_book_items` schema to separate *labor blocks* from *material templates*, or add `category` discriminators. Finish material breakdown needs a child-row structure (primer/paint/stain/lacquer as separate rows). Details TBD.
- Walkthrough hatch: door walkthrough and finish walkthrough both reuse the base-cabinet walkthrough shell at `app/(app)/onboarding/base-cabinet-calibration/page.tsx` — parameterized by setup type and persisted to `rate_book_calibration`.
- Last-used defaults: a single `last_used_slots_by_product` jsonb column on the org (or `profiles`) table. Every saved line updates it; every new line of that product reads from it. No per-subproject scoping, no inference query.
- Subproject markup settings: `subprojects.defaults` jsonb column holding `{ consumablesPct, wastePct }`. Margin + install happen at the subproject level, separately from line cost.
- **No upstream changes needed to shop-rate-setup** — wood machining stays inside the assembly bucket.

## Rate-book propagation — when shop rates or walkthroughs change

When a user updates their shop rate, re-calibrates a walkthrough, or edits a material template, the line composer applies the new numbers to **new lines only**. Existing saved lines are a snapshot — they don't silently recompute.

Any of these trigger staleness:

- Shop rate edits (any department, any rate)
- Walkthrough recalibration (base cabinet, door, finish, any)
- Material template edits (sheet price, sheets/LF, etc.)

Subprojects containing stale lines get a **"Rates have changed since these lines were saved"** flag with an **"Update to latest rates"** action. Sold subprojects **already lock rates today** (the `sold` state exists on the schema), so the freeze-on-sale behavior comes for free — just wire the flag/action to check against it.

**Detecting staleness:** rather than stamping a `rate_book_version` number (which would flag subprojects whenever *anything* in the rate book changes, including edits that don't touch their slots), compare each saved line's stored cost against a fresh `computeBreakdown` run using current rate-book values. A line is stale when its recomputed total differs from its stored total. This is per-line precise — cosmetic rate-book edits (a material rename, adding a new template nobody uses yet) never raise a false flag. Compute cost is trivial: subprojects have tens of lines, not thousands.

The update action re-runs `computeBreakdown` against the current rate book and overwrites each line's snapshot in place — like a "save again" pass across every line, bulk.

## Uncalibrated-combo hatch — two UX modes

When a line selects a finish-on-style-on-category combo that hasn't been calibrated yet, the composer surfaces a hatch to fill it in right there. Two flavors depending on how much needs to be captured:

- **Inline mini-card** — collapses into the composer itself. Good when the gap is small (e.g. only the material breakdown for one cab-height card is missing). User fills, hits save, line updates.
- **Full walkthrough modal** — full-screen flow. Used when the gap is larger (e.g. a brand-new finish-on-style combo with zero calibration), or when the user explicitly chooses "+ Add new" from a dropdown.

The composer picks which mode based on how many fields are empty. Both routes write back to the same rate-book structure so there's one source of truth.

## Resolved this round

- **Finish walkthrough** → one walkthrough, collapsible combo rows. Users fill only what they sell; partial calibration is a first-class state.
- **Door labor multipliers** → fixed for V1 at 1.0× / 1.3× / 2.5×. Not shop-configurable (revisit only if real users push back).
- **V1 product scope** → Base + Upper + Full. Drawer, LED, Countertop come after the end-to-end loop is proven.
- **Install** → subproject-level prefill (guys × days × shop install rate) with a single % complexity markup; description lists typical reasons to mark up.
- **Rate-book propagation** → new lines auto, existing unsold subprojects get a flag + "update to latest rates" action, sold subprojects freeze. `sold` state already exists on schema and already locks rates — just wire the flag UI.
- **Staleness detection** → per-line recompute-and-compare. No global version stamp. Avoids false-positive flags on cosmetic rate-book edits.
- **Uncalibrated-combo hatch** → inline mini-card for small gaps, full modal for bigger ones.

## Onboarding surface — how welcome + calibrations actually appear

The welcome and the required first-time calibrations are **not a page** in the app. They're a **first-login overlay** that mounts on top of the dashboard and unmounts when done. The user never sees `/welcome` or `/onboarding` in the nav, and the route they're on (the dashboard) is still technically the dashboard — the overlay is just sitting on top of it.

**Flag that triggers the overlay:** `users.onboarded_at` (nullable timestamp). Null = show the overlay. Set to NOW() when onboarding completes, and the overlay never mounts again.

**What's in the overlay (required, sequential):**

1. **Welcome screen** — 1 screen. Sets the POV: "You already know your craft. We're going to capture what you know, once, so your estimates match your shop." Single CTA: *Start setup.*
2. **Shop rate setup** — the shop-rate-setup flow, embedded. Department rates + install rate.
3. **Base cabinet calibration** — the base-cabinet-walkthrough flow, embedded. One 8' run of base cabinets across the four departments. Seeds the rate book.

On completion, the flag is set and the user lands on the dashboard with an empty project list, a populated rate book, and the ability to price a Base line.

**What's NOT in the overlay (lazy, in-context):**

- **Door walkthroughs** — fire from the composer hatch the first time someone picks an uncalibrated door style (slab, shaker, etc.). No upfront door calibration required.
- **Finish walkthroughs** — fire from the composer hatch when a line selects an uncalibrated finish-on-style-on-category combo. Collapsible rows let users fill only what they sell.
- **Upper / Full multipliers** — come for free from the base calibration plus fixed multipliers. Nothing to configure.

**Architecture notes:**

- `WelcomeOverlay` component mounts in `app/(app)/layout.tsx`. Reads `users.onboarded_at` via a small hook (`useOnboardingStatus`). If null, renders the overlay as a full-screen, non-dismissible modal on top of whatever route the user is on.
- The shop-rate and base-cabinet flows are built as **components** (not pages), so they can be embedded in the overlay *and* exposed later as standalone pages at `app/(app)/settings/shop-rate/` and `app/(app)/settings/calibration/base/` for recalibration. Same component, two mount points.
- **No "skip" until both required steps are done.** The user can back out to the welcome screen within the overlay, but can't dismiss the overlay entirely until the rate book has a shop rate and at least one calibrated base cabinet — otherwise the app is in an unusable state (nothing can be priced).
- If the user closes the tab mid-onboarding, reopening re-mounts the overlay at the step they left off (track `onboarding_step` on the profile, or infer from which rate-book rows exist).

**Re-calibration later:** The same walkthrough components live under settings pages for users who want to re-run calibration. The welcome overlay is strictly first-login.

## Next — move from spec to build

The spec is closed enough to start building. Remaining work is implementation, not design:

1. Build the shop-rate and base-cabinet walkthroughs as **embeddable components** (not just pages), plus the `WelcomeOverlay` that composes them. Add `users.onboarded_at`.
2. Wire the composer into the real subproject detail page — replace the current pricing UI.
3. Extend `rate_book_items` to cleanly separate labor blocks from material templates (and finish materials' primer/paint/stain/lacquer sub-rows).
4. Add the `last_used_slots_by_product` jsonb and the per-line recompute-and-compare staleness check.
5. Port the door walkthrough from the prototype modal to the shared walkthrough shell, plus build the finish walkthrough with collapsible combo rows. Both mount from composer hatches, not from the welcome overlay.
6. Ship Base / Upper / Full. Run at least one real estimate end-to-end before adding Drawer / LED / Countertop.
