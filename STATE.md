# millsuite-mvp-profit — current state

**Read this before touching the repo.** Pair with `/mnt/code/built-os/product-strategy-notes.md` (the source-of-truth strategy doc), the eight mockup HTML files in `/mnt/code/built-os/` (the design source of truth for the estimating module), and `BUILD-PLAN.md` in this repo (the concrete build plan for the pre-prod approval system).

---

## The three products, and which one this repo is

1. **Built OS** (`/mnt/code/built-os/`) — Andrew's existing standalone product. Profit + Scheduling + Estimating all in one. The estimating piece is convoluted, opaque, hard to fix. Works, but not well.

2. **MillSuite MVP** (this repo) — started life as a simple profit tracker for tiny shops. Simple Kanban, light parsing. Profit tracking + scheduling + time tracking are shipped. Real, working, sellable.

3. **The new estimating module** — currently being designed. Takes inspiration from Built OS's concepts (labor hours, materials, learning loop) but is being rebuilt from scratch to be transparent, database-driven, clean. Once it works here, it becomes the blueprint for fixing Built OS's estimating.

**This repo is the target for the new estimating work.** The question of modularity (bolt-on vs. standalone products) is explicitly deferred — focus is on getting estimating right.

---

## Source of truth for the estimating design

Eight mockup HTMLs in `/mnt/code/built-os/`, produced over a series of design sessions:

| Mockup | Covers |
|---|---|
| `parser-first-dashboard-mockup.html` | Sales entry point. Drawing dropzone as hero. Auto-parse client/address/LF. Pipeline columns: New → 50/50 → 90% → Sold → Lost. **Leads are projects with a stage field, not a separate entity.** |
| `subproject-editor-mockup.html` | The core estimating experience. Keyboard-first line editor, clone, editable per-dept-hour overrides, clone highlighting. |
| `project-rollup-mockup.html` | Project overview + QB preview modal with editable descriptions, exclusions, terms. Lock on "Mark as sold." |
| `rate-book-mockup.html` | Tree of concrete millwork items. Each item has per-department labor hours embedded (eng/cnc/assembly/finish/install), sheets, sheet cost, material, hardware, history, jobs. Options as a separate scopable layer. |
| `sold-handoff-mockup.html` | Dedicated handoff review page. Selection cards grouped by owner (Client / Shop / Vendor). Schedule slot. QB deposit + milestones. Lock/unlock panel. Three actions: exit / save draft / confirm. Note from strategy doc: "partially wrong — rebuild against real Selection model." Needs a resync against `preprod-approval-mockup.html` (see BUILD-PLAN.md). |
| `suggestions-mockup.html` | Learning-loop feed. Bidirectional rate nudges (suggest raise OR lower based on actuals). |
| `onboarding-mockup.html` | Six-step wizard. **Deprioritized** per strategy notes — revisit later with shop-rate-from-calculator default. |
| `preprod-approval-mockup.html` | **Apr 19.** Post-sold material + finish approval surface. Variable-count spec slots per subproject, derived from estimate callouts (not subproject-type templates). Each slot = material + finish only (construction detail lives on drawings). Three states: pending / in review / approved. Linked slots for auto-inheritance. Sample submission + client response logged with ball-in-court timers. Parallel drawings approval track. Change orders shown as estimate-line diff (original line vs. proposed) with repricing + net change. **V1 is manual throughout:** no portal signing, no email automation, no QB auto-push. Hard production gate: subproject moves to "Ready for scheduling" only when all slots + all drawings approved. |

The strategy notes' "Repo reality check" section describes *Built OS's existing data model* (Selection, DrawingRevision, FinishSample, ChangeOrder, SpecLibraryItem with statuses `unconfirmed → pending_review → confirmed → voided`, selection_history audit, revision-counted sample lifecycle, etc.). **This section is descriptive, not prescriptive — it's documenting what Built OS does, not a spec for what to build here.** The mockups are the spec.

---

## What shipped before Apr 18 (on-track)

- `app/(marketing)/` — landing, pricing (3 tiers, "coming soon"), signup, waitlist → Klaviyo
- `app/(app)/dashboard` — KPIs, projects list, invoice parser, AI shop report
- `app/(app)/projects`, `projects/[id]` — project + subproject CRUD, department hours, bid vs. actual, time log drawer, P&L. (Subproject cards already exist — partial starting point for the subproject editor mockup.)
- `app/(app)/time` (+ `time/mobile`) — native time tracking
- `app/(app)/reports` — shop grade, outlook, completed projects, diagnostic waterfall drawer
- `app/(app)/capacity`, `schedule`, `team` — scheduling module
- `app/(app)/settings` — shop rate, org settings
- API: parse-invoice, project-outcome, shop-report, weekly-snapshot, schedule-ai, stripe-webhook, checkout, waitlist, auth
- Clean confirm dialog, styled, replacing browser confirms

---

## What the Apr 18 thread built (and why most of it misses the mockups)

Two commits, ~7,000 lines. Shortest honest summary: the thread read the strategy notes' "Repo reality check" section (which describes *Built OS's schema*) and treated it as the build spec. It cloned Built OS's architecture. It did not build from the mockups.

### Commits

- `f528a9e` — "Scaffold MillSuite OS: leads, portal, rate book, pre-production" (27 files, +5,777 lines)
- `2789207` — "Add portal enablement flow, estimate page, email + Klaviyo libs" (20 files, +1,290 lines)

### Piece-by-piece fit

| Area | Built | Mockup fit |
|---|---|---|
| **Leads** (`app/(app)/leads/`, `lib/leads.ts`, `leads` + `lead_subprojects` tables, `convertLeadToProject`) | Separate leads entity with columns New → 50/50 → 90% → Sold → Lost; drag-to-sold copies subprojects into a new `projects` row. | **Wrong data model.** `parser-first-dashboard-mockup` and `sold-handoff-mockup` explicitly say: one entity (project) with sales stages; lead→project conversion isn't a separate concept. Kanban columns are right; the entity split and the conversion-copy mechanic contradict the mockup. |
| **Rate book** (`app/(app)/settings/rate-book/`, `lib/rate-book.ts`, `rate_book_categories` + `labor_rates` + `material_pricing` tables) | Categories tree + generic labor-rates + generic material-pricing rows with confidence badges. | **Partial.** Shell is right (categories, confidence). Missing the core model from `rate-book-mockup`: items as first-class objects with per-department labor hours embedded, sheets + sheet cost + hardware on the item, options layer, history audit, jobs list. The whole point of the mockup's model is transparency — you can't get there without per-dept labor per item. |
| **Pre-production page** (`app/(app)/projects/[id]/pre-production/`) | Separate 500-line page showing selections, drawings, change orders for a project. | **Wrong surface.** Strategy notes: "Andrew wants these unified into one project dashboard." The `sold-handoff-mockup` shows selection *cards* integrated into the post-sold project experience, not a separate page. |
| **Estimate page** (`app/(app)/projects/[id]/estimate/`) | Static printable client-facing proposal page (description, amount, terms, signature line). | **Wrong surface.** `project-rollup-mockup` designs a QB preview *modal* with editable descriptions, exclusions, and terms — the editable preview is the point (so you can tune what goes to QB without changing internal numbers). The built page is a read-only proposal. |
| **Selections + schema** (`lib/selections.ts`, plus tables `selections`, `selection_history`, `spec_library_items`, `drawing_revisions`, `finish_samples`, `change_orders`) | Full Built-OS-style preproduction schema. Selection statuses `unconfirmed → pending_review → confirmed → voided`. DrawingRevision with `is_stale`. FinishSample with revision counts. ChangeOrder with draft → sent_to_client → approved/rejected. | **Clone of Built OS.** Strategy notes tag the sold-handoff as "partially wrong — rebuild against real Selection model" but that's ambiguous — the mockup work is meant to *redesign* the approval flow, not replicate Built OS. This schema is the Built OS schema; it's what we're supposed to simplify, not reimplement. |
| **Client portal** (`app/portal/[slug]/`, portal APIs, `portal_timeline` table, `cash_flow_receivables` table) | Slug-based client login, signoff, password reset, email invite, portal timeline. | **Not in any mockup.** Scope creep. **Parked** per Andrew — don't delete, revisit later. |
| **Learning loop tables** (`shop_rate_snapshots`, `project_learnings`, `rate_adjustment_proposals`) | Foundation tables only; no UI. | **Foundation usable.** `suggestions-mockup` feed is not built; these tables may or may not match what the feed needs, but the shape is plausible. |
| **Vendors/POs tables** | Foundation only; no UI. | **Not in any active mockup.** Defer. |
| **Klaviyo + email libs** (`lib/klaviyo.ts`, `lib/email.ts`) | Email + Klaviyo helpers. | **Keeper.** Useful regardless of product direction. |
| **Checkout route** | Multi-tier pricing (Starter/Pro/Pro+AI), trial period, seats. | **Keeper.** Matches the marketing pricing tiers. |
| **.gitignore** | Adds introspect.mjs, probe-*.mjs (local scripts with service-role keys). | **Keeper.** |
| **Role-gate component** + layout wrap | Role-based access control around the app layout. | **Keeper but re-evaluate.** Useful pattern; confirm the role model matches the real team/plan design. |

### What the mockups call for that's NOT built at all

- Parser-first dashboard + drawing parser pipeline
- Sold-handoff review page (the dedicated transition UI from the mockup)
- Suggestions / learning-loop feed UI
- QB preview modal with editable descriptions + exclusions + terms
- Unified project dashboard that folds pre-prod in (strategy notes' "open thread")
- The rate book's item-with-embedded-per-dept-labor model

---

## Current decision (Apr 18, end of this session)

**Cherry-pick what's useful, drop what's wrong — but don't delete anything yet.** The plan is:

1. Keep the Kanban leads columns UI as a starting visual shell for the sales pipeline; **rewrite the data layer to be one-entity-with-stages.**
2. Keep the rate-book category + confidence UI as a shell; **add the missing item-with-per-dept-labor model.**
3. **Park the client portal.** Not dropping. Build later.
4. **Redesign pre-prod approvals from scratch.** Next session's focus. The Built-OS Selection schema currently in the migration file should be treated as a reference, not a commitment.
5. **Don't build** the pre-production-as-separate-page surface. Unify into the project dashboard.
6. **Don't use** the static estimate page as the final answer for client-facing pricing. The QB preview modal from the mockup is the target.

Nothing has been deleted. No commits have been reverted. All decisions are recorded here for the next thread.

---

## Apr 19 — pre-prod approval design closed out

The pre-prod approval process was designed end-to-end and captured as `/mnt/code/built-os/preprod-approval-mockup.html` (the 8th mockup). Three iteration rounds landed on this shape:

1. **Approval items are derived from estimate callouts, not subproject-type templates.** Whatever the estimator flagged for approval on the estimate lines becomes a variable-count set of spec slots on the subproject. Typical main kitchen: 3–5 slots. Island with custom metal toe kick: add a slot. No fixed template.
2. **Slots are material + finish only.** Construction detail (edge profiles, dimensions, integrated pulls, fabrication notes) lives on drawings. Slot shows: material type (e.g. "White oak veneer") + finish (e.g. "Rubio Pure") + sample tracking + approval state.
3. **Three states per slot:** pending → in review (sample submitted) → approved. Sample submission and client response are logged with timestamps and a ball-in-court chip so "client hasn't responded in 6 days" is visible.
4. **Linked slots** — e.g. island cabinet interior automatically inherits main kitchen cabinet interior. One source of truth, one approval covers both.
5. **Custom fallback.** When rate book has no match (blackened steel toe kick), slot is marked custom with a free-text spec.
6. **Drawings run on a parallel track.** Explicit drawing revisions with timestamps and ball-in-court timers, replacing the current Built OS trick of inferring status from the Google Drive folder filename.
7. **Change orders = estimate-line diff.** Side-by-side original line vs. proposed line (material, labor, totals), net change computed, "no price change" option. No auto-send, no portal signatures, no QB push. V1 is a manual log: user sends the CO via email on their own, marks client approval date by hand, and handles the QB invoice update themselves (pattern deferred — see BUILD-PLAN.md).
8. **Hard production gate.** Subproject moves to "Ready for scheduling" only when all slots approved AND all drawings approved. "Ready for scheduling" is the status, not "Ready for CNC."

The design intentionally defers: email automation, portal-based client signatures, QB auto-push, auto-resend nudges. Those are Phase 6+ once the manual loop is proven.

## Next up

Everything needed to start building is now captured in `BUILD-PLAN.md`. That file contains:
- **System audit** — upstream/downstream interface map (what feeds the approval surface, what it feeds back out)
- **Closed-loop assessment** — where the loop closes inside the product and where it hands off to a human
- **10 open questions** that must land before code gets written
- **First-cut data model** — four tables (`approval_items`, `item_revisions`, `drawing_revisions`, `change_orders`)
- **Six-phase build plan** starting with schema and ending at automation
- **Mockups needing resync** — `sold-handoff`, `subproject-editor`, `project-rollup`, `rate-book`
- **Stop/ask list** — triggers that should pause the next thread and check with Andrew

Read `BUILD-PLAN.md` next.

---

## Rules for the next thread

1. Read `product-strategy-notes.md` AND this file AND the seven mockups before writing code.
2. The mockups are the spec. The strategy doc's "Repo reality check" section describes Built OS — it's reference, not a build target.
3. When in doubt, stop and ask. Don't scaffold a new module without confirmation.
4. Language rules from the strategy doc apply everywhere: "%" not "points", "difference" not "delta", "commits/starts/goes live" not "fires", labor in hours first, whole-number percentages.
5. Harvest is a competitor (native time tracking is MillSuite's answer). Never recommend integrating it.

---

## Apr 19 — mockup resync closeout (second session)

The remaining five mockups from BUILD-PLAN.md's resync queue shipped across two sessions. At the close of the second session, all eight HTML mockups have a live counterpart in the app.

### What shipped this session (after the first session's parser-first dashboard + subproject editor)

- **Project rollup + QB preview modal** → `app/(app)/projects/[id]/rollup/page.tsx` (~1040 lines).
  Translates `project-rollup-mockup.html`. Loads project + subs + `estimate_lines` + rate book, rolls up per-sub with `computeSubprojectRollup`, sums across subs. Left column: subproject cards with margin colors, linking back to the subproject editor. Right: sticky financial panel (expandable labor-by-dept, materials, consumables, hardware, install subtotal, cash-flow cascade 30/40/20/10). Historical-comparison block (3 most-recently-sold sibling projects). Action bar: Printable estimate, Preview QB, Send to QB (stub), **Mark as sold → routes to new `/handoff` page**. QB modal is live-only component state (no `qb_line_overrides` table yet — deferred until real integration).

- **Rate-book items editor** → `app/(app)/settings/rate-book/items/page.tsx` (~650 lines).
  Translates `rate-book-mockup.html` for the `rate_book_items` + `rate_book_material_variants` schema (the tables the subproject editor + rollup actually read — distinct from the legacy `labor_rates` / `material_pricing` UI at `/settings/rate-book`, which is kept for backward compat). Two-pane layout (deferred the options pane from the mockup — no options table yet). Searchable item list on the left with a confidence badge (New / Emerging / Reliable / Stale) driven by `confidence_job_count` + `confidence_last_used_at`. Detail pane: inline-edit name, unit dropdown, per-dept labor-hours grid with live $ computation, sheet cost / hardware cost, default callouts chip editor, material-variants sub-editor with set-default, and a price-buildup breakdown. Reachable via an `Items →` link added to the legacy rate-book page header.

- **Sold handoff review page** → `app/(app)/projects/[id]/handoff/page.tsx` (~720 lines).
  Translates `sold-handoff-mockup.html`. Reached by clicking **Mark as sold** on the rollup — no more `window.confirm`. Four panels:
  1. **Pre-production preview** — every `estimate_line.callouts` (or rate-book-item default_callouts when the line didn't override) becomes a proposed selection card. Grouped by a heuristic owner: client (color/finish/hardware keywords), vendor (hinge/slide/order keywords), shop (everything else). Empty state when no callouts exist anywhere — tells the user to add callouts first.
  2. **Schedule preview** — department-hours chips + a stub suggested production window (3 weeks out + 1 week per 50h, snapped to Monday). Links to `/schedule` for the real capacity engine; no slot commit here.
  3. **Invoice preview** — 30 / 40 / 20 / 10 cascade, deposit row highlighted. Copy notes the QB auto-send is stubbed.
  4. **Lock / unlock summary** — two-column "what locks / what unlocks" card explaining the transition.
  Confirm button calls `createApprovalItemsFromProposals()` (new helper in `lib/approvals.ts`) then `updateProjectStage(id, 'sold')`, then redirects to the project page. Preview is read-only on already-sold projects.

- **New helper in `lib/approvals.ts`** — `proposeSlotsForLine()` + `createApprovalItemsFromProposals()` + `guessSlotOwner()`. The proposal function is pure (UI preview-friendly); the creator de-dupes by `(subproject_id, label)` so a re-run after a partial handoff won't duplicate rows. New slots start `state=pending`, `ball_in_court='client'` for client-bucket items, `'shop'` for the rest.

- **Rate-book discovery link** — `app/(app)/settings/rate-book/page.tsx` gets an Items→ chip pointing at the new items route.

- **Rollup → handoff wiring** — `handleMarkSold` in the rollup page now just calls `router.push('/projects/[id]/handoff')`. Dropped the unused `updateProjectStage` import.

### Schema drift vs. the mockup (documented, not built)

- **No `is_install` column on subprojects.** The rollup page uses a heuristic (`activity_type` / name contains "install") to mark install-style subprojects. The handoff page currently doesn't show the dashed install card treatment — the mockup's three-track visual isn't critical for the review page.
- **No `qb_line_overrides` or `projects.qb_export_json`.** QB modal state is live-only. Acceptable until the real QB integration lands.
- **No `shop_options` / modifier table.** Rate-book items page built 2-pane instead of the mockup's 3-pane.
- **No `projects.sold_at` column.** Handoff relies on `stage='sold'` flipping `status='active'` + `production_phase='pre_production'` via existing `lib/sales.updateProjectStage`. Matches what `lib/subproject-status.ts` + the scheduling gate already read.
- **Schedule slot commit is stubbed.** The capacity engine on `/schedule` is the real commit path; handoff just previews dept hours and links there.
- **Deposit invoice doesn't auto-send.** Toast copy tells the user the QB sync is stubbed.

### BUILD-PLAN.md queue — close

All five resync tasks on BUILD-PLAN.md are done. Parser-first dashboard (session 1), subproject editor (session 1), project rollup + QB modal (this session), rate-book items editor (this session), sold-handoff (this session). The product now maps end-to-end from drawing drop → lead → 50/50 → 90% → rollup review → handoff confirm → pre-prod approval track. All eight mockups have a live surface.

### Next thread

Pick one:
- **Suggestions / learning-loop feed** — `suggestions-mockup.html` has no app surface yet. The foundation tables (`shop_rate_snapshots`, `project_learnings`, `rate_adjustment_proposals`) exist from Apr 18 but no UI.
- **Real QB integration** — replace the three QB stubs (send estimate, fire deposit, post invoice) with actual QuickBooks API calls. Requires the QB app registration + token-refresh flow.
- **Schedule slot commit from handoff** — wire the handoff confirm into the capacity engine so the slot actually books, not just previews.
- **Selection-card owner bucketing** — current heuristic is string-based. A `rate_book_items.slot_owner_hint` column would let the estimator be explicit instead of relying on callout keywords.
- **Install subproject enum** — add `subprojects.is_install boolean` so the rollup page's dashed-card treatment + the install-subtotal math stop relying on string heuristics.
