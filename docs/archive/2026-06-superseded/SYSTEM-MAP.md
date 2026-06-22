# MillSuite estimating — system map

Plain-English map of the whole estimating module. Originally written from the 8 HTML mockups before any code existed; the architecture described below is now mostly built. Read this first to understand the model — the loop, the responsibilities, the seams. For ground truth on *what's currently shipped vs in-flight*, see CURRENT-STATE.md.

---

## The one-sentence version

A drawing gets dropped in → parser creates a project with subprojects and a client → user prices the subprojects using a library that grows with them (plus freeform lines for anything the library doesn't cover) → the project rolls up with margin + a variable cash-flow schedule → on "mark as sold," the estimate locks, finish-spec approval cards come online, a best-case production slot appears on the schedule → material-change decisions during approvals create change orders → when the job closes, actuals feed a learning loop that suggests rate updates → rate book gets sharper → next estimate is more accurate.

Everything downstream depends on the line items being right. The line items only work because the rate book is seeded. The rate book only stays honest because the learning loop feeds it. It is one loop, not eight pages.

**Terminology:** the user-facing name for the material+finish decisions on a line is **finish specs**. "Callouts" is fine as the internal/data-model name. Both refer to the same thing: a list of named material+finish pairs attached to each estimate line, which becomes the seed for approval cards at handoff.

**QB posture:** QB is **watched, not pushed to**. The system does not send estimates, invoices, or bills to QuickBooks. The user creates QB records manually. MillSuite watches the QB API for deposits and payments to advance project state (deposit received → deposit milestone closed, etc.). The QB preview modal on the rollup is a **copy source**, not an auto-send.

---

## The pieces, in the order a user touches them

### 1. First-run state (welcome overlay + starter rate book)
**Amended 2026-04-24** — Phase 11's business-card/past-estimate/bank-statement onboarding was retired. The first-run experience is now the `WelcomeOverlay` (Phase 12 Item 5) sitting on top of the dashboard: welcome screen → first-principles shop-rate walkthrough (overhead + team comp / billable hours → derived `orgs.shop_rate`) → base-cabinet walkthrough (9 operations across an 8′ run, calibrated to Eng/CNC/Assembly/Finish per-LF hours). On completion the overlay stamps `users.onboarded_at` and never mounts again.

For v1, the system ships **pre-populated**:
- A **starter rate book** loaded out of the box (carcasses, doors, drawers, panels, trim, lighting, specialty hardware, install, engineering). Rates are shop-average defaults with gray "untested" confidence.
- The user can **keep, edit, delete, or add** to anything. It's theirs from day one.
- A **single blended shop rate** on `orgs.shop_rate`, derived by the first-principles walkthrough (per-dept hours are still captured on lines for scheduling/time-tracking, but dollars roll up at one blended rate — Phase 12 Item 12). The old per-department rate table (`shop_labor_rates`) is deprecated.
- The user edits the shop name and a few basics in Settings whenever they get around to it.

Effect: a first-login user lands on the overlay, calibrates two things (shop rate + base cab), closes it, and can price a Base line immediately. The overlay is the **only dark-mode surface** in the app — everything else is light mode (white panels, `#E5E7EB` borders, `#111` text, `#2563EB` accents).

### 2. Sales dashboard (parser is the hero)
Top nav: Sales | Projects | Schedule | Financials | Team.

The sales page IS the parser. Big dropzone front and center. User drags a drawing (ID set, arch, rough elevations, floorplans from a junior designer — sometimes unnamed).

Parser reads the PDF and returns:
- Candidate **client names** (click to select, click again to ignore, type your own if nothing fits)
- **Other names** on the page → role dropdown: ignore by default, save as GC contact, or set as client
- **Subprojects detected** (Kitchen, Pantry, Butler's Pantry, Island, etc.) with sheet provenance (A-2.1, A-3.0) and rough LF counts
- If the parser got nothing (no names on the drawing), chips swap for editable text inputs — user types what it should be

Click "Create project" → one Project record, one Client, empty Subproject shells with the parser's names. Project stage = "New lead."

**Pipeline below the dropzone:** columns for stages — New lead / 50/50 / 90% / Sold MTD / Lost MTD. Projects are cards that move across columns as the stage changes.

**Critical:** There is no separate "lead" entity. Every parse is a project. If it doesn't move, mark it lost. (This kills the half-built lead table from the Apr 18 thread.)

### 3. Subproject editor (the core estimating experience)
This is where most of the user's time is spent. One screen per subproject (Kitchen, Island, Pantry, Mudroom, etc.).

**Line table columns:** drag handle | item | qty + unit | options chips | hours | material | total | actions.

**Keyboard-first:**
- `/` opens the add-line autocomplete
- autocomplete groups results: Carcasses / Doors / Drawers / Panels & scribes / Lighting / Specialty hardware / Trim / Engineering
- pick an item → placeholder becomes "{item} — how many {unit}?" — type qty, Enter to commit
- arrow keys, Enter, Backspace, ⌘D duplicate

**Two ways to add a line:**
- From rate book (the library grown in onboarding + over time) — the fast path
- Freeform — type a name that doesn't match anything, enter rate / unit / per-dept hours inline. Used when nothing fits (custom install item, one-off metal thing, etc.)

**Repeat freeform → rate book:** if the user enters the same freeform line name across 2–3 jobs, the system offers to promote it into the rate book. This is how the library grows naturally.

**Right panel, appears when a line is selected:**
- Options: stackable checkboxes (inset +0.4 assembly hrs, oversized +0.05 assembly +0.02 finish, etc.) — toggling just this line, not the whole project
- Build-up per department: editable hours with an "override" badge and "reset to default" link
- Material: either sheets × $/sheet OR flat $/LF — whichever the item uses
- Consumables: auto 10% of material (hinges, glue, fasteners, finish supplies — not exposed, just rolled in)
- Hardware: specialty only (pulls, knobs excluded because client-provided; hinges excluded because they're consumables)
- Line total and margin

**Margin coloring:** ≥ 32% ok (green), 25–32% warn (yellow), < 25% bad (red).

**Clone from past:** modal pulls lines from a similar past subproject. Added lines get a green "just added" badge so the user sees what came in.

**Finish specs on each line** — this is the interconnection Andrew flagged.
Every line carries a `callouts` list (user-facing name: **finish specs**): named material + finish decisions like "cabinet exterior," "cabinet interior," "hardware," "glass." These are the seeds that become approval cards later at handoff. The subproject editor has to surface the finish specs as part of the line because they're what the shop and client will later agree on.

**Install is a separate subproject.** Priced flexibly — Andrew does **per-man-per-day**. Other shops do per-box or flat rate. The install subproject takes whatever unit and rate the user enters on each line. Starter library includes "install day," "2nd-floor premium," "hoist day" — all editable.

**Freeform is first-class — not a fallback.** Everything the shop builds is custom: cabinets, but also restaurant back bars, column wraps, finish panels, curved booths, coffered ceilings. Plenty of those jobs will be priced entirely as freeform lines with no rate-book reference. A freeform line supports:
- Any unit — LF, EA, DAY, HR, JOB, LS (lump sum)
- Per-dept hours entered inline
- Material in any mode — sheets × $/sheet, flat $/LF, or **lump sum $** (for weird jobs that don't break into clean units)
- Finish specs can still be attached (so a curved booth can still carry its material+finish approval)
- Consumables still auto-compute at 10% of material
- Options still stack if the user wants them

A "weird job" subproject is just a subproject whose lines are all freeform. Per-dept rollups still work because each line carries its own hours breakdown.

### 4. Rate book (displayed as "MillSuite · Pricing")
The back-end library. Context strip says: *"Back-end. You usually won't come here — pricing happens in projects, and the system learns as you go."*

**Ships pre-populated.** A starter set of items is loaded out of the box so day-one pricing works without any setup. All starter items show gray "untested" confidence. The user can keep, edit, delete, or add anything. Over time their own history replaces the starter numbers.

Three-pane layout: items tree (left) | detail (center) | options layer (right).

**Each item has:**
- Name, parent group, unit (LF / EA / DAY / JOB / HR)
- Usage count, last used, confidence badge
- Labor: per-dept hours per unit
- Material: sheet-based or flat $/LF
- Consumables: computed at 10% of material
- Hardware: specialty items only with a note
- Options list (linked to the shared options layer)
- History (audit trail: "learned from Marsh kitchen + Walsh remodel + Palmer galley")
- Jobs list (every project that has used this item)

**Confidence badges** tell the user how much to trust the rate:
- **green** — well-tested (many jobs, stable)
- **yellow** — few jobs
- **gray** — new / untested (starter library defaults before any actuals)
- **red** — looking weird (numbers are drifting or the actuals disagree)

**Price build-up** (same shape everywhere the price is shown):
Labor (per-dept hrs × shop rate) + Material + Consumables (10% of material) + Hardware.

**Edit modal** asks two things:
- *Apply to:* this item / this item and everything beneath it / everywhere
- *Why:* manual change / better data / accepting a learning suggestion
Every edit goes to the Changes tab. Old value preserved.

**Options are a separate layer.** Stackable modifiers. Each option has:
- Name (inset, oversized, glass front, integrated light, etc.)
- Scope (shop-wide, cabinets & doors only, etc.)
- Effect (× 1.25 hours, × 1.4 material, + $12/sheet, etc.)

At the project level, the user just toggles options per line. One-job overrides don't change the default — but if the user keeps overriding, the learning loop suggests the default move.

**Tabs on an item:** Price / Changes / Past jobs / Notes.

### 5. Project rollup
The project container page. Everything comes together here.

**Header:** name, client pill, address, created/updated, project total + margin vs target.

**Left column — subprojects:**
One card per subproject (name, LF subtitle, lines/hours, total $, margin %, status Draft/Complete). Install is its own card with a dashed border.

**Right sticky — financial panel:**
- Project total, margin vs target
- Breakdown: Labor (expandable per-dept) + Material + Consumables (10% of material) + Specialty hardware + Install subproject
- **Cash flow — per-project, variable.** The user builds whatever milestone structure the deal needs: 50/25/25, 30/40/20/10, 30/10/10/10/10, 40/60 — anything. No fixed default. Each milestone has a name, a % (or flat $), and a trigger (at signing / at production start / at install start / at install complete / custom). Nothing gets sent to QB — the user creates the corresponding invoice in QB manually when the trigger hits. MillSuite tracks status by watching QB for deposit receipts.

**Historical comparison (collapsible):** this project's margin vs rolling average on similar past jobs. Shows similar past project cards for context.

**Actions bar:** Save draft / **Preview QB export** / Send proposal (optional toggle) / **Mark as sold**.

**QB preview modal (critical — the interconnection Andrew pointed at):**
Editable client-facing descriptions, specs, exclusions, terms. Install day count NOT surfaced to client (so fewer days used is a quiet win).

**This modal is a copy source, not an auto-send.** Nothing pushes from MillSuite to QB. The user previews and edits the text here, then copies it into QB manually when they create the estimate. But the same spec text **travels into preproduction** inside MillSuite — what the user writes in this modal becomes the spec payload that shows up on approval cards at handoff. That's why this modal exists at this point in the flow: it's the user's one place to write the client-facing spec, and that spec has two destinations (QB copy, and MillSuite's own preprod cards).

**Mark as sold** → goes to the handoff screen.

### 6. Sold handoff
**This is a confirmation step — like the QB modal.** Not a "commit everything and fire the deposit" moment. The user is saying: "this estimate is sold, move it into production." That's it. Nothing gets sent to QB. The schedule is suggested, not committed. The manager can still move the slot anytime.

Banner: *"Mark this project as sold?"* — confirming flips the project from estimate to production mode.

One screen, four panels (all previews / summaries):

**Finish-spec approval cards — preview** — the cards that will come online once this is marked sold. Grouped by owner:
- **Needs client input** (yellow) — hardware pick, paint color + sheen, mudroom bench cushion
- **Shop-ready** (green, locked from estimate) — kitchen doors spec, carcass construction, drawers, butler pantry, mudroom built-in, finish schedule
- **Vendor orders** (purple) — hinges PO, drawer slides PO, pulls PO (linked — waits on the hardware card)

Each card shows: source estimate line → spec text → owner → due date. Cards are derived from the **finish specs** on estimate lines plus the QB modal spec payload.

**Schedule — best-case slot preview (not a commitment).** The system looks at current capacity + this project's dept hours and suggests the next available production window. Shown here so the user has a realistic default. It can be accepted as-is or adjusted now, and the schedule manager can move it anytime after. Internal tool only — nothing about this slot is sent anywhere.

**Cash flow milestones — preview.** The per-project milestone schedule built on the rollup (30/40/20/10, 50/25/25, or whatever the deal is) is shown here as a reminder. Nothing is pushed to QB. The user creates each QB invoice manually when the trigger hits; MillSuite watches QB for deposit/payment events to close milestones.

**What changes when confirmed:**
- Estimate **locks** — line-item edits from this point go through a change order
- Finish-spec approval cards come online (pending/review states open up)
- Drawings track opens per subproject
- Change order workflow opens
- Time tracking can now log against this project's subprojects
- Project stage flips to Sold

Three actions: Exit without confirming / Save handoff notes as draft / **Confirm — mark as sold**.

### 7. Preproduction approvals
One page per sold project. Hard gate between estimating and scheduling.

**Gate banner at top:** counts (approved / in review / pending). Subprojects can't move to scheduling until every approval item **AND** drawings on that subproject are marked approved.

**Each subproject has two tracks side-by-side:**

**Approval items track** — each item is one decision: *material + finish*. Construction details (door profile, drawer joinery, dimensions, hardware quantities) live on the drawings, not here. Pulled from the callouts on estimate lines.

Three states: **Pending / In review / Approved.**

Each item has:
- Spec (material cell + finish cell, with "was" when a change is pending)
- Revision number
- Ball-in-court chip (client / shop / stale — turns red after 2+ days)
- Timeline of sample history (rev 1 sent → "too yellow" → rev 2 → approved)
- Link to source estimate line
- Custom flag if no rate-book match
- Linked-to-sibling (e.g. island interior = "linked to main-int · auto-approved")

Actions per item:
- **Send another sample** (submit modal — what's being sent, how, notes)
- **Log client response** → three outcomes:
  - Approved → lock item, update gate
  - Requested a revision → same material, different tone, next sample
  - Wants a different material → **drafts a change order** (see below)

**Drawings track** — shop drawings per subproject. Same 3-state pattern with its own rev history. Client redline note shows up inline. Rev 3 marked approved = signed PDF on file.

When every approval item + every drawing reads approved → subproject status flips from "Blocked" to "Ready for scheduling." Gate counts update. When all subprojects are ready, the project moves into the schedule.

### 8. Change orders (V1 = manual)
A CO is drafted automatically when a client picks a different material on an approval item. The CO panel shows:

- **Estimate line diff:** original line on the left (walnut slab · oil · $11,930), proposed on the right (rift oak · Rubio · $10,510). Proposed side's spec is editable and reprices from the rate book.
- **Net change to client** — big dollar amount, red for up, green for down.
- "No price change" checkbox — for material swaps that don't move the number.

**Manual client approval block** — status field (Not yet asked / Sent to client / Approved / Declined), date, notes. No portal, no email automation for V1.

**QB handoff stays manual for V1.** The original invoice has a deposit on it and the client might flip-flop, so a rushed auto-sync is risky. Honest note on the CO: once approved, the user opens QB and either edits the existing invoice ("CO-002 · island material change · −$1,420") or issues a separate CO invoice. We pick a pattern once a few real COs run through.

Approve → CO flips to applied, spec updates on the approval item, estimate line updates with diff in audit. If the CO changes scope (not just material), the downstream selection cards / drawings may need rev bumps — handled per-item.

### 9. Schedule + production
The proposed slot from handoff is now a movable item on the schedule — the manager can shift it whenever reality shifts. Nothing is locked in. Time tracking is native — crew clocks in/out on project / subproject / department.

**Milestone behavior.** The project's cash-flow milestones (built on the rollup) don't fire anything. They're reminders: when a milestone's trigger hits (production start, install start, install complete, etc.), the user knows to go create the matching invoice in QB. MillSuite watches QB for the deposit/payment event and closes the milestone when it clears.

### 10. Suggestions feed (the learning loop)
Back-end page. Context strip: *"The system watches closed jobs and proposes updates — in both directions. Nothing changes unless you accept."*

**Five kinds of suggestions:**
- **Running over** (big-up, > 10%) — estimates too low, the shop is losing time
- **Running under** (big-down, > 10%) — "opportunity to sharpen" — user could bid tighter without eating margin
- **Minor** (≤ 10% either direction)
- **Split** — one item should be two (e.g. shaker-paint vs shaker-stain; system noticed 3 manual overrides for stain-grade, offers to make it permanent)
- **Quiet** — item hasn't been used in 60+ days (offer to archive)

**Each suggestion shows:**
- Source jobs (user can untick any to recalculate — "tell me without the Henderson job")
- Confidence (high / med / low) with a trustLabel
- Impact in hours AND dollars at the shop rate ("+0.9 hr per LF, +$612 on a typical pantry")
- Actions: accept / defer 30 days / reject / review source jobs / ignore as scope-driven / see-split / archive

Accept → rate book item updates, old value preserved in Changes tab.

**Depends on time tracking + vendor PO matching actually working.** Until a handful of jobs have closed with actuals, this page is mostly empty.

---

## Denormalized columns (read this before writing to them)

A handful of columns hold a cached copy of a value that lives canonically
elsewhere. They exist because every list / header surface reads them, and
loading the canonical source (estimate lines, full client row) on each
render would be too expensive. The trade-off is that **mutating the
canonical source must propagate to every cache, on every code path**.

| Column | Canonical source | Canonical write path(s) | Notes |
|---|---|---|---|
| `projects.bid_total` | live `priceTotal` from the project rollup (cost buckets × project margin) | `lib/project-totals.ts` exports `recomputeProjectBidTotal{,ForSubproject,ForLine}` — call after every pricing-input mutation | All list / header surfaces read this column directly: sales card, kanban, /projects card, dashboard report, pre-prod header. The project page also writes back on render as a backstop. |
| `projects.client_name` | `clients.name` (when `client_id` is set), or a fallback freeform string from import (when `client_id` is null) | `lib/clients.ts` exports `setProjectClient` (link/unlink) + `updateClient` (rename + propagate) | The picker on the project detail page is the only UI that writes `client_id`; other surfaces read `client_name` only. |

### `projects.bid_total` write paths

Every mutation that affects `priceTotal` MUST call `recomputeProjectBidTotal*`
after the underlying write succeeds. The current call sites are:

- `lib/composer-persist.ts` — `saveComposerLine`, `updateComposerLine`
- `lib/estimate-lines.ts` — `addEstimateLine`, `updateEstimateLine`,
  `deleteEstimateLine`, `duplicateEstimateLine`, `attachLineOption`,
  `detachLineOption`
- `lib/install-prefill.ts` — `saveInstallPrefill`
- `lib/change-orders.ts` — `approveCo` (after `applyApprovedCo`)
- `lib/composer-staleness.ts` — `bulkRefreshStaleLines`
- `lib/sales.ts` — `createRoomSubprojects`, `seedEstimateLinesFromParsed`
- `app/(app)/projects/[id]/page.tsx` — TargetMarginEditor commit/reset
  (handled implicitly by the project page write-back useEffect)
- `app/(app)/projects/[id]/handoff/page.tsx` — `handleConfirm` (Mark Sold)

Adding a new pricing-input mutation? Add a `recomputeProjectBidTotal*` call
right after the underlying write. Failure to do so leaves dashboards
stale silently.

A future DB trigger (`AFTER UPDATE OR INSERT OR DELETE` on
`estimate_lines`, `estimate_line_options`, `subprojects` (install_*),
`projects.target_margin_pct`, `change_orders.state`) could enforce this
server-side and let us delete every call site. Until then, the call-site
list above is the contract.

### `projects.client_name` write paths

`lib/clients.ts` is the only file that should be doing `UPDATE clients`
or `UPDATE projects SET client_name`. `setProjectClient` handles
link/unlink (writes both `client_id` and `client_name`); `updateClient`
handles rename and propagates the new name to every linked project's
`client_name` cache.

If you find yourself doing a direct supabase mutation on either column,
move it through these helpers instead. The denorm cache is the kind of
thing that drifts silently when bypassed.

---

## Where data lives (who owns what)

- **Shop** (one per tenant) — name, dept list, shop rate(s), rate book items, options library
- **Project** — header, client, address, stage, subprojects, financials, milestones (variable schedule)
- **Subproject** — type, lines, dept hours, margin, drawings list, approval items list (post-sold)
- **Line** — rate-book link OR freeform custom, qty, unit, options applied, per-dept hour overrides (if any), material mode (sheets / flat $ / **lump sum**), **finish specs list** (internal name: callouts)
- **Finish spec / callout** — material spec name + finish spec name. This is what becomes an approval item at handoff.
- **Milestone** — name, % of total (or flat $), trigger (at signing / production start / install start / install complete / custom). Per-project. MillSuite tracks status via QB deposit watching.
- **Approval item** (post-sold only) — spec (material + finish), revs, timeline, state, ball-in-court, link to originating line + callout, owner (client/shop/vendor)
- **Drawing revision** (post-sold only) — per subproject, 3-state, rev number, notes
- **Change order** (post-sold only) — diff between original and proposed line, net price, client-approval status, QB reconciliation note
- **Time entry** — on project/subproject/dept, feeds actuals
- **Vendor PO match** — connects a PO to a project, feeds material actuals

---

## The seams (where one page hands off to another)

- Parser → Project + Subprojects + Client
- Subproject editor line pick → Rate book item read
- Subproject editor freeform line + repeat → rate book promotion candidate
- Estimate line **finish specs** + QB modal spec text → preproduction approval cards (at handoff)
- Project "mark as sold" → estimate locks, approval cards come online, schedule slot is suggested (not committed), time tracking unlocks, change order workflow unlocks. **Nothing pushes to QB.**
- Approval card "different material" → change order drafted
- Change order approved → estimate line + approval item spec update, audit written
- All approval items + drawings on a subproject approved → subproject flips to "ready for scheduling"
- User creates invoices manually in QB when milestones trigger → MillSuite watches QB for deposit/payment events → milestone status updates
- Closed job + actuals (time + PO matches) → Suggestions feed
- Suggestion accepted → Rate book item updates, old value saved in Changes tab

---

## What's broken in the current code (from what I've been told)

- Parser is a filename-read stub, not a real PDF parser
- Sales "create project" flow lands on an empty shell, not the parser
- Old inline subproject form still default (new subproject editor exists but isn't wired)
- Subproject editor forces a rate-book pick, no working freeform entry, no add-item modal
- `/settings/rate-book/items` has no explainer, isn't framed as back-end
- Rate book is generic, non-branded, doesn't grow with use, no confidence / Changes tab / audit
- Rate book is not **pre-populated** with a starter set → users see an empty library on first use
- ~~No shop-wide dept labor rates flowing into items~~ _Resolved differently — Phase 12 Item 12 replaced per-dept rates with a single blended `orgs.shop_rate` derived from overhead + team comp / billable hours. Per-dept hours are still captured on lines (for scheduling/time tracking) but dollars use one rate._
- No options layer (stackable modifiers)
- No lump-sum material mode on freeform lines → can't price curved booths / back bars cleanly
- No per-project milestone builder → hard-coded 30/40/20/10 doesn't fit real deals
- No QB preview modal with editable specs
- No handoff screen, no preprod approvals, no change-order flow, no suggestions feed
- No QB watcher → milestone status can't auto-update from deposits
- Clone-from-past missing
- Links between surfaces broken
- Lingering Apr 18 artifacts: separate leads table, Selection schema cloned from BUILT OS, portal scope creep

---

## The build-order logic (not a plan — the reasoning behind one)

Every downstream page needs something upstream to already exist with the right shape:

- **The rate book has to be right first**, because every estimate line reads from it. If the rate book doesn't have confidence, options, per-dept labor, material modes, consumables, hardware — then the subproject editor can't render the right-panel build-up, and the rollup can't do per-dept rollups.
- **The rate book ships pre-populated** with a starter set so day-one pricing works without setup. No onboarding wizard is needed for v1 — it can come later as a TurboTax-grade pass.
- **Freeform lines have to be first-class**, not a fallback. Plenty of real jobs (back bars, curved booths, coffered ceilings) will have zero rate-book lines. Freeform needs any-unit, any-hour-breakdown, and lump-sum material on day one.
- **Finish specs on lines have to be designed into the subproject editor from day one**, because they're the handoff to approvals. Bolting them on later means re-touching every line.
- **Per-project cash-flow milestones have to be designed into the rollup from day one**, because the schedule is variable (50/25/25, 30/10/10/10/10, etc.) and a fixed default doesn't fit real deals.
- **The QB preview modal has to be designed into the rollup from day one**, for the same reason — its spec text feeds approval cards on the preprod side.
- **Approval cards, change orders, scheduling surface, and milestone watchers all depend on "mark as sold" existing**, which depends on the rollup being complete.
- **Time tracking and QB watching both depend on just API-listening**, not pushing. That's simpler than it sounds — we never need auto-send logic.
- **Time tracking and vendor PO matching have to exist before Suggestions can do anything useful.** Suggestions is the last thing, not the first.

So the build is top-down from the rate book shape and the line-item data model, then horizontal through parser → editor → rollup → handoff → approvals, then downstream through scheduling + CO + learning loop. Onboarding is deferred.

---

## Resolved with Andrew (Apr 19)

- **Finish specs** is the user-facing name. Callout is fine as the internal data-model term.
- Approval items are **only material + finish**. Construction details (profiles, joinery, dimensions, hardware counts) live on drawings.
- Cash flow is **per-project variable** — 50/25/25, 30/40/20/10, 30/10/10/10/10, whatever the deal is. User builds the milestone list.
- **QB is watched, not pushed to.** No auto-send of estimates or invoices. User creates QB records manually. MillSuite watches the QB API for deposits/payments.
- Handoff is a **confirmation step**, not a commit — like the QB modal. Schedule is suggested (best-case), not locked. Manager can move the slot anytime.
- ~~**Onboarding is deferred.** Ship v1 with a pre-populated starter rate book. Come back later with a TurboTax/Apple-grade onboarding (business card parse, past estimate upload, redacted bank statement for shop rate).~~ _Updated 2026-04-24: Phase 11's parsing-centric onboarding (business card OCR, past estimate, bank statement) was retired. The actual first-run experience is the `WelcomeOverlay` with the first-principles shop-rate walkthrough + base-cabinet walkthrough (Phase 12 Items 5 + 12). The starter rate book still ships pre-populated; the overlay calibrates the two things that must be calibrated before any line can be priced._
- **Install pricing is flexible by line** — per-man-per-day, per-box, or flat rate depending on the shop.
- **Freeform lines must handle weird custom work**: column wraps, curved booths, back bars, coffered ceilings, finish panels. Any unit, any hour breakdown, lump-sum material mode added.
- **Qty vs. separate lines:** six identical booths = one line, qty 6. One large serpentine booth made up of six similar parts = one subproject with separate lines per part. Qty is for true repeats; components of a single custom piece get their own lines inside one subproject.

---

This file + `BUILD-ORDER.md` are the bible. If either is wrong, fix it here first before touching code. Everything else in this folder is implementation or scratch.
