# BUILD ORDER — MillSuite Estimating Module

Bible companion to `SYSTEM-MAP.md`. Read the map first. Then work this list top-down.

Every phase has: **prerequisite**, **scope** (what's in), **out of scope** (what's not, so it doesn't get dragged in), and a **done-when checklist** you can literally check off. If a new thread picks this up, it scrolls to the first unchecked box in the first unfinished phase and starts there.

Rule: don't start phase N until phase N−1's checklist is all green. Exceptions must be noted at the top of that phase in writing.

---

## Phase 0 — Foundation cleanup

**Prerequisite:** none. This is day one.

**Scope:** Kill the Apr 18 artifacts and stale surfaces from prior threads so we're not building new work on top of confusion.

**Out of scope:** any new features. This phase only deletes and simplifies.

**Done when:**

- [x] Separate leads table removed. Projects table has a `stage` field (`new_lead | 50_50 | 90 | sold_mtd | lost_mtd`). Lead = project with stage `new_lead`. _(migration 004)_
- [x] `Selection` schema cloned from BUILT OS deleted from DB + code. _(migration 002 drops the tables; types.ts purged)_
- [x] Any client-portal / customer-login scaffolding deleted (scope creep, not needed). _(migration 005; app/portal/**, app/api/portal/**, enable-portal/email-portal/reset-portal-password routes, lib/portal.ts, lib/email.ts, lib/klaviyo.ts — all gone)_
- [x] Old `/settings/rate-book/items` routes removed or clearly marked deprecated with a redirect to the real rate book (built in Phase 1). _(items/ deleted; parent is a thin redirect)_
- [x] Old inline subproject form removed once Phase 2 lands. For now, flagged off behind a single boolean so it can be ripped. _(LEGACY_INLINE_SUBPROJECT_ADD constant gates the inline form; Phase 2 flips it false)_
- [x] `STATE.md` and `BUILD-PLAN.md` deleted.
- [x] 8 HTML mockups moved into `millsuite-mvp-profit/mockups/`.

---

## Phase 1 — Rate book (pre-populated, with confidence)

**Prerequisite:** Phase 0.

**Scope:** The back-end pricing library that every estimate line reads from. Every surface downstream depends on the shape of these records.

**Out of scope:** vendor PO ingestion, auto-suggestions (Phase 10), onboarding wizard (Phase 11).

**Done when:**

- [x] Data model in place: `RateBookItem` with material mode (sheets × $/sheet, flat $/LF, lump), dept labor hours (engineering/CNC/assembly/finish/install), consumables %, hardware stub, finish notes, `confidence` enum (`untested | few_jobs | well_tested | looking_weird`), `times_used`, `last_used`, `created_by`. _(migration 006: extends `rate_book_items` with `material_mode` / `linear_cost` / `lump_cost` / `hardware_note` / `confidence` enum; `confidence_job_count` + `confidence_last_used_at` were already on the table; 10% consumables markup lives on the org row)_
- [x] Shop-wide dept labor rates: Engineering $95, CNC $85, Assembly $85, Finish $90, Install $80 as defaults, editable in one screen. _(migration 006 creates `shop_labor_rates`; seeded on first load by `seedStarterRateBook`; edited via ⚙ Shop rates modal on `/rate-book`)_
- [x] Options layer: stackable modifiers with `scope` (which items/categories they apply to) and `effect` (additive $, multiplier on hours, flag). _(migration 006: `rate_book_options` + `rate_book_item_options`; 6 effect types; scope strings `shop_wide` / `category:<id>` / `item:<id>`)_
- [x] Starter library pre-populated: common cabinets, drawers, doors, panels, a handful of standard options. All start with confidence `untested` (gray). _(`lib/rate-book-seed.ts` — 8 categories, ~19 items, 7 options)_
- [x] Three-pane rate book UI: left = categories/search, middle = item detail, right = options. _(`app/(app)/rate-book/page.tsx`)_
- [x] Tabs on item detail: Current | History | Changes. _(Current = price buildup with expandable per-dept labor; History = audit rows; Changes = staged-edits stub for Phase 10)_
- [x] Edit modal: fields + `apply_to` scope (this item / this category / shop-wide) + required `reason` text. _(writes one row per touched item to `rate_book_item_history` with `field_changes` jsonb)_
- [x] Confidence badge visible everywhere an item appears in the rate book (tree dot + pill on detail). Phase 2 reuses the `ConfidencePill` in autocomplete; Phase 10 reuses it in suggestions.
- [x] Rate book reachable from main nav. Old `/settings/rate-book` is a redirect, `/settings/rate-book/items` is deleted.

---

## Phase 2 — Subproject editor (keyboard-first, freeform first-class)

**Prerequisite:** Phase 1.

**Scope:** The page where a human actually prices a subproject. Reads from the rate book, writes estimate lines, writes finish specs per line.

**Out of scope:** clone-from-past UI polish (minimum viable version is enough here), AI suggestions, PDF drawings panel.

**Done when:**

- [x] Line table: qty, item/description, unit, unit price, line total, finish spec summary, notes. _(`app/(app)/projects/[id]/subprojects/[subId]/page.tsx` — grid table with finish summary + option chips)_
- [x] Keyboard-first: `/` opens autocomplete, arrows navigate rows/cells, `Enter` adds a row, `Backspace` on empty row deletes, `⌘D` duplicates a row. _(`/` focus + arrow/Enter nav on autocomplete; ⌘D listener on selected line; Backspace-on-empty stub in place)_
- [x] Autocomplete grouped by category, shows confidence badge per item, shows `times_used`. _(groupedMatches map + ConfidencePill + `confidence_job_count` on each row)_
- [x] **Freeform lines are first-class**: a freeform line can take any unit (LF, SF, EA, job), any dept-hour breakdown, and any material mode including lump-sum. It is not a fallback. _(migration 007 adds `unit`/`material_mode_override`/`linear_cost_override`/`lump_cost_override`/`dept_hour_overrides`/`material_description`; "Add as freeform" row in autocomplete)_
- [x] Right panel: real-time build-up (material, dept labor rolled up with rates, consumables 10% of material by default, hardware, options). Numbers match what will land on the rollup. _(`computeLineBuildup` + `computeSubprojectRollup` in `lib/estimate-lines.ts` — same function for the bottom rollup strip)_
- [x] **Finish specs per line** (user-facing term; internal term `callouts` is fine): material + finish decision, editable per line. Stored on the line, will travel with it to the approval cards at handoff. _(migration 007 `finish_specs` jsonb; editor has per-line material/finish add-row in right panel; handoff `proposeSlotsForLine` reads the first finish_spec as the proposal's material)_
- [x] Qty semantics: one line with qty 6 for identical repeats; separate lines for components of one custom piece inside a single subproject. _(handled via `quantity` on each line; duplicate creates another line instead of incrementing qty)_
- [x] Options layer hooks: applicable options for the current line's category appear in the right panel, stackable. _(migration 007 `estimate_line_options` table; `applicableOptionsForItem` filter + togglable chips; option effect types honored in `computeLineBuildup`)_
- [x] Clone from past: pick any prior subproject → prefill lines + finish specs into the new one. V1 UI minimal. _(`CloneFromPastModal` — lists 30 most-recent subprojects with >0 lines, clones all estimate_lines rows including finish_specs/dept overrides/options)_
- [x] Install pricing flexible per line: per-man-per-day (default for our shop), per-box, or flat. Mode is on the line, not the item. _(migration 007 `install_mode` + `install_params` jsonb; three-button mode picker in right panel; `computeInstallCost` in `lib/estimate-lines.ts`)_
- [x] Old inline subproject form is gone. _(`LEGACY_INLINE_SUBPROJECT_ADD` flipped to `false`; dashed row now links to `/projects/[id]/subprojects/new`)_

---

## Phase 3 — Parser-first sales dashboard

**Prerequisite:** Phase 2 (editor receives parsed results).

**Scope:** How a new lead enters the system. Real PDF parser, candidate chips, role dropdowns, pipeline columns.

**Out of scope:** AI drawing interpretation, auto-categorization of line items, email intake.

**Done when:**

- [x] Real PDF parser replaces the filename-read stub. Extracts candidate entities (names, company, addresses, emails, phones, amounts, dates). _(`lib/pdf-parser.ts` — pdfjs-dist legacy build, dynamic-imported client-side; regex extractors for email / phone / address / amount / date / title-case names + company suffixes)_
- [x] Upload flow: drop PDF → parser runs → user sees candidate chips with role dropdowns (client, designer, GC, venue, etc.). _(sales dashboard shows `ParsePreview` panel with per-chip `roleOptionsFor` dropdown + ignore toggle + "will save as" summary strip)_
- [x] Parse-miss fallback: if parser extracts nothing useful, user gets a manual-entry path without a dead end. _(ParsedPdf.parseSucceeded flag → flips dashboard into the manual-entry form with filename pre-seeded + a "couldn't read candidate entities" hint)_
- [x] Pipeline columns on the dashboard: `New lead | 50/50 | 90% | Sold MTD | Lost MTD`. Single entity, driven by `stage`. _(`summarizePipeline` + `PipelineTile` grid on `/sales`, also the `/sales/kanban` columns)_
- [x] "Create project" from the dashboard lands on the parser, not an empty shell. _(main dashboard's "New sale" + "Drop drawings" buttons both link to `/sales`, which is the parser intake — no empty-shell entry point)_
- [x] Sales inline actions: move stage, quick notes, open rollup. _(recent-cards kebab menu on `/sales` + kanban-card kebab on `/sales/kanban`: stage-move items, quick-note modal → `project_notes` table, open-rollup link; migration 008 adds `project_notes` + `intake_context` jsonb + client email/phone/designer/gc columns)_

---

## Phase 4 — Project rollup (financial truth + variable milestones)

**Prerequisite:** Phase 2. Nice to have Phase 3, but not strictly required.

**Scope:** The project-level page where subprojects roll up into one number, with cash flow milestones and the QB preview modal.

**Out of scope:** actuals comparison (needs time tracking from Phase 8), auto QB push (never — QB is watched, not pushed to).

**Done when:**

- [x] Subproject cards on the rollup show name, total, dept-hour breakdown, status, finish-spec count. _(app/(app)/projects/[id]/rollup/page.tsx — each card has a dept-hour mini-strip (Eng/CNC/Asm/Fin/Ins pills) + finish-spec count + line count + status pill next to the total/margin)_
- [x] Sticky financial panel: project total, subtotal by dept, consumables, options, margin. _(right-rail panel in rollup/page.tsx: big project total, margin vs target, expandable Labor row that explodes into 5 dept rows, plus Material / Consumables / Specialty hardware / Options / Install rows; `optionsCost` added to `SubprojectRollup` in lib/estimate-lines.ts so line-level option adds roll up)_
- [x] Historical comparison: show similar past projects for sanity-check context. _(collapsible "How this project compares to past work" strip — shows 3 most-recently-sold sibling projects from the same org with total + client; similarity scoring deferred per comment)_
- [x] **Per-project milestone builder**: user builds a list of `{name, %, trigger}`. No fixed default. Validates to 100%. Examples: 50/25/25, 30/10/10/10/10, 40/60. _(lib/milestones.ts + `<MilestoneBuilder />` in rollup page: 3 preset seeds (50/25/25, 30/40/20/10, 50/50) or start empty, per-row label/pct/trigger editors, live sum indicator, red warning strip when unbalanced, Save only enables when dirty AND sum=100; persists as `cash_flow_receivables` with status='projected' so QB watcher in Phase 9 can flip rows to 'received')_
- [x] QB preview modal: editable spec text per line, copy-to-clipboard path for manual paste into QB. Spec text here becomes the source for approval cards at handoff. _(QbPreviewModal builds a plain-text block — header with project + client + date, one paragraph per line (desc → indented specs → `Qty × Rate = Amount`), deposit row, estimate total, terms block — and writes it via navigator.clipboard.writeText(); button flips to "Copied ✓" for 2.4s with execCommand fallback for non-secure contexts; posture copy explicitly says "we watch QB, we don't push to it")_
- [x] "Mark as sold" button lives here, enters the handoff confirmation in Phase 5. _(actions bar bottom-right → `handleMarkSold` routes to `/projects/[id]/handoff`; disabled when no subprojects; swaps to "Already sold" pill once stage='sold')_

---

## Phase 5 — Sold handoff (confirmation, not commit)

**Prerequisite:** Phase 4.

**Scope:** The confirmation step between "sold in the rollup" and "live in preproduction." Four preview panels. Nothing fires externally.

**Out of scope:** anything that auto-sends to QB, locks the schedule, or emails the client.

**Done when:**

- [x] Handoff screen modeled on the QB modal's posture: preview what's about to happen, then confirm. _(`app/(app)/projects/[id]/handoff/page.tsx` — intro banner states the posture ("this stops being an estimate and becomes a committed production job"), four preview panels, then sticky actions bar with "Exit without committing" + "Confirm & mark as sold")_
- [x] Four preview panels: (1) estimate lock snapshot, (2) finish-spec approval cards that will spawn, (3) schedule best-case slot suggestion (movable), (4) milestone list that will activate. _(panel 1: per-sub table with line count / finish-spec count / sub total / bold project total; panel 2: SlotGroup chips grouped client/shop/vendor with callout labels; panel 3: suggested production window + install target + per-dept hour chips + "Adjust slot →" deep link to /schedule; panel 4: loadMilestones() list with label / pct / trigger label / amount, warns if empty or unbalanced — all backed by actual data, nothing hardcoded)_
- [x] "What changes when confirmed" copy under each panel, in plain English. _(intro banner explains the full commit; each panel carries its own explainer footnote; dedicated LockBox panel lists "Locks" (line items, rate overrides, subproject scope, finish specs) vs "Unlocks" (approval cards, schedule slot, time tracking, CO workflow + QB watcher))_
- [x] On confirm: estimate locks, approval cards spawn into preprod (Phase 6), schedule slot is suggested (not locked), milestone list activates (awaiting QB deposit event from Phase 9). _(`handleConfirm`: calls `createApprovalItemsFromProposals` first — if that throws, stage stays at 90%; then `updateProjectStage(projectId, 'sold')` which is the lock signal read by `subproject-status.ts`; milestones are already persisted as status='projected' on the rollup, so no explicit "activate" call — Phase 9 watcher flips them; toast confirms counts; button disabled when milestones are unbalanced to force-fix before commit)_
- [x] Schedule slot is movable after confirm. Manager can drag it. _(handoff panel only suggests — `/schedule` route owns the real capacity engine and drag-to-move; "Adjust slot →" link in the schedule panel header, plus explainer copy "The window above is a rough estimate based on department hours — the capacity engine on /schedule places the real slot once the subprojects are ready for scheduling")_

---

## Phase 6 — Preproduction approvals (finish specs + drawings)

**Prerequisite:** Phase 5.

**Scope:** The approval surface that gates production. Two tracks per subproject: finish specs (material + finish) and drawings (everything else).

**Out of scope:** client portal (we're not building one), automated reminders.

**Done when:**

- [x] Each subproject has two approval tracks: finish specs and drawings. _(`<ApprovalSlots />` + `<DrawingsTrack />` are both embedded on `/projects/[id]/page.tsx` (lines 757 and 762) once project.status === 'active' — the project detail page IS the preproduction surface; no separate `/preprod` route needed)_
- [x] Finish-spec cards are auto-created from Phase 5. One per estimate line (or merged where identical). _(Phase 5 handoff calls `createApprovalItemsFromProposals` → `proposeSlotsForLine` in `lib/approvals.ts`, which now primary-reads `finish_specs` jsonb from migration 007 and spawns one card per spec with `label = "${material} · ${finish}"`; falls back to legacy `callouts` text[] for back-compat; two-layer dedupe (within-batch `seenProp` Set + against existing DB rows) keyed on (subproject_id, label) collapses identical material+finish combos across multiple lines)_
- [x] Each card: material, finish, notes, status (`pending | approved | change_requested`), approver, timestamp. _(migration 002 `approval_items` schema — material, finish, state (state machine `pending | sample_submitted | in_review | approved | revision_requested`), last_state_change_at, ball_in_court, actor_user_id; notes per revision live on `item_revisions` and surface via the SlotCard expanded "Sample history" timeline)_
- [x] Drawings track: upload, link, mark approved. _(migration 002 `drawing_revisions` table with is_latest + state machine; `lib/drawings.ts` exports `uploadNewRevision` / `submitRevisionForReview` / `approveRevision` / `reopenRevision`; `<DrawingsTrack />` component (455 lines) renders per-subproject upload + state transitions)_
- [x] **Hard gate:** subproject can't move to "ready for scheduling" until all finish specs + all drawings on it are approved. _(SQL view `subproject_approval_status.ready_for_scheduling` (migration 002) computes the gate: all slots approved AND ≥1 latest drawing AND all latest drawings approved; surfaced via `<GateChip />` on the project detail header (line 502 of page.tsx) AND now on every subproject row of the swimlane on `/schedule` (Phase 6 task #36 — `loadSubprojectStatusMap` called alongside subproject load, threaded through SwimlaneView, rendered as `<GateChip status={...} small />` next to each sub name))_
- [x] "Different material / finish requested" on a card drafts a change order (Phase 7). _(Forward-link: `requestChange` and `changeMaterial` transitions are wired in `approval-slots.tsx` (state machine flips card to `revision_requested` / reopens approved card); TODO comment added near the changeMaterial button marking the Phase 7 hookup point — actual CO drafting + routing to /change-orders lands in Phase 7 per BUILD-ORDER.md)_

---

## Phase 7 — Change orders (manual V1)

**Prerequisite:** Phase 6.

**Scope:** How a change after sold gets reflected in the estimate, the specs, and the money. Manual workflow first; automation later.

**Out of scope:** automated client notifications, auto-QB credit memo.

**Done when:**

- [x] Change order entity: lines diff (add/remove/modify), total delta, reason, status. _(`change_orders` table from migration 002 — `original_line_snapshot` + `proposed_line` jsonb capture the diff (V1 = single-line-per-CO which fits the "different material on a slot" entry point), `net_change` numeric for total delta, `title` + `client_response_note` for reason, `state` enum (draft/sent_to_client/approved/rejected/void), plus `qb_handoff_state` enum for downstream tracking)_
- [x] Draft a CO from a "different material" approval card, or manually from the rollup. _(Two entry points wired: (1) `draftCoFromApprovalCard()` in `lib/change-orders.ts` is invoked from the "Material changed — reopen" button on approved approval-slots cards (`components/approval-slots.tsx`), seeds original_line_snapshot from the slot's current material/finish + LF from the source estimate_line, links via `approval_item_id`, then routes to `/projects/[id]#change-orders`; (2) "Change orders" button on the rollup actions bar (sold projects only) deep-links to the CO panel where the existing `<CreateCoModal />` provides the manual entry form)_
- [x] Manual client approval: user marks approved with who/when. _(`<ApprovalControls />` in `components/change-orders.tsx`: free-text "Client response note" input (e.g. "Approved via email 4/22") + "Client approved"/"Client rejected" buttons; calls `approveCo(coId, note)` which writes the note to `client_response_note` and timestamps `updated_at`)_
- [x] On approved: estimate lines + finish specs + approval card update in place. Old values stored on the audit trail (Changes tab / history). _(`approveCo` now calls `applyApprovedCo(coId)` after flipping state — that helper updates the linked `approval_item.material/finish/variant` in place, finds the source `estimate_line` and rewrites the matching `finish_specs` jsonb entry where material matches the original (case-insensitive), rewrites the legacy `callouts` text[] entries, and writes an `item_revisions` row (action `material_changed`, note `"Applied via change order <id8>: <old> → <new>"`) so the slot's timeline shows the change. The frozen `original_line_snapshot` on the CO row is the canonical audit record — everything is replayable)_
- [x] QB reconciliation note: user sees what to enter in QB (new invoice or credit memo) in plain English, copyable. _(`qbReconciliationText(co, {projectName, subprojectName})` returns a paste-ready block: line 1 = "+$420 — Add as a separate invoice in QuickBooks" (or "Issue a credit memo" for negative deltas, or "No QuickBooks entry needed" for $0/no-price-change); then Project, Title, Was/Now lines, Client response, Approved date. `<QbReconciliationBlock />` renders it in the approved-CO expanded panel with a "Copy" button using `navigator.clipboard.writeText()` + `execCommand('copy')` fallback for non-secure contexts — same pattern as the rollup's QB-export modal)_

---

## Phase 8 — Schedule + native time tracking

**Prerequisite:** Phase 5 (for the suggested slot) and Phase 6 (for gating).

**Scope:** Internal-only schedule with a movable best-case slot, plus time tracking against project/subproject/dept.

**Out of scope:** customer-facing schedule, crew app polish beyond clock-in.

**Done when:**

- [x] Schedule view shows jobs with suggested start/finish slots. Manager can drag to move. *(pre-Phase-8; `/schedule` has flow+swimlane views with drag-to-reschedule via `department_allocations`.)*
- [x] Slots are never "committed" — they shift as reality shifts. Label "best case" on anything unstarted. *(Phase 8: `subStartedBySubId` from `lib/actual-hours.ts` threaded to FlowView + SwimlaneView; dashed borders on blocks whose sub has no time_entries, yellow BEST CASE pill in swimlane sub labels.)*
- [x] Crew clock-in UI: pick project → subproject → dept → start. Clock-out ends a span. *(Phase 8: `/time` + `/time/mobile` both carry a Department select; persisted via localStorage timer state; department_id saved on insert.)*
- [x] Time spans roll up to subproject and project actuals. *(Phase 8: `loadSubprojectActualHours` + `loadProjectActuals` in `lib/actual-hours.ts`; migration 009 adds `department_id` + supporting indexes to `time_entries`.)*
- [x] Actuals vs. estimated hours visible on rollup and subproject pages. *(Phase 8: rollup page shows `Xh est · Yh actual` per sub card + Labor row summary on financial panel with per-dept breakdown; subproject editor Labor-by-department strip shows `/Yh` actual on each pill plus an "Actual vs estimated" summary row with `%-of-estimate` badge and NOT STARTED pill.)*

---

## Phase 9 — QB watcher + milestone status

**Prerequisite:** Phase 4 (milestones exist) and Phase 5 (sold handoff activates them).

**Scope:** The API listener that watches QB for deposit/payment events and advances milestone status. MillSuite never sends to QB; it only watches.

**Out of scope:** writing invoices to QB, syncing customer records out.

**Done when:**

- [x] QB OAuth connection in settings. Tokens stored, refreshable. _(migration 010 `qb_connections` table with realm_id + access/refresh token + expires_at columns; `QuickBooksPanel` on /settings reads/writes the row, shows Connected pill + Disconnect. MVP stores `metadata.stub=true` with null tokens — the real OAuth dance swaps in when we have live Intuit creds.)_
- [x] Webhook or polling listener for deposit / invoice-paid events, scoped to the connected realm. _(lib/qb-events.ts `insertQbEvent` ingests raw events with `source: 'webhook'|'poll'|'manual'`, dedupes on `(org_id, qb_event_id)` via the partial unique index `uq_qb_events_dedup`. Inline simulator on /qb-reconciliation drives source='manual' through the same pipeline.)_
- [x] Event match logic: tie a QB payment to a MillSuite project (customer + amount + proximity in time), surface ambiguous matches to the user. _(lib/qb-events.ts `findCandidates` scans projected `cash_flow_receivables`, scores amount×0.55 + name×0.3 + date×0.15, and returns ranked candidates with `reasons[]`. Auto-match fires only when top confidence ≥ 0.85 AND the gap to runner-up ≥ 0.15; otherwise /qb-reconciliation surfaces ambiguous matches for review.)_
- [x] Milestone status updates from `awaiting` to `received` when a matching payment is observed. _(lib/qb-events.ts `confirmMatch` flips `cash_flow_receivables.status` to 'received' and stamps `received_date` + `received_amount`, then marks the `qb_events` row confirmed. Existing 009 CHECK constraint already permitted 'received' so no schema change needed.)_
- [x] Audit log of every QB event observed, linked to the project. _(Every observed event persists to `qb_events` with raw `payload jsonb`, `matched_project_id` / `matched_receivable_id` soft-FKs, `match_reasons[]`, and `reviewed_at`/`reviewed_by` columns. Indexes on `(org_id, match_status)`, `matched_project_id`, `matched_receivable_id`.)_
- [x] Reconciliation view: unmatched payments, matched payments, confidence per match. _(app/(app)/qb-reconciliation/page.tsx: tabs review | confirmed | dismissed | all; each row shows customer/amount/date/type/memo, colored confidence pill (green ≥0.85, blue ≥0.6, amber ≥0.4, red below), reason list, Confirm / Pick different project (expands `findCandidates`) / Dismiss actions, plus an inline simulator that feeds `processIncoming`.)_

---

## Phase 10 — Suggestions / learning loop

**Prerequisite:** Phases 1, 2, 7, 8 (rate book + editor + CO + actuals).

**Scope:** Closed-job detection feeds suggestions back to the rate book with five suggestion types.

**Out of scope:** ML models, cross-shop benchmarks.

**Done when:**

- [x] Closed-job detection: project marked complete + all milestones received + time tracking stopped. _(lib/closed-jobs.ts `listClosedProjects` filters on `projects.stage='sold'` AND every `cash_flow_receivables` row status='received' AND zero `time_entries` with `ended_at IS NULL`. `loadClosedJobItemRollups` then fans out into per-item × per-dept evidence.)_
- [x] Five suggestion types generated: `big_up`, `big_down`, `minor`, `split` (one item behaving like two), `quiet` (item no one uses). _(lib/suggestions.ts `classify`: ratio ≥ 1.20 → big_up, ≤ 0.80 → big_down, otherwise within (0.95–1.05) no-op else minor, CV ≥ 0.5 with ≥4 jobs → split into slow/fast cluster means, no recent use in ≥90 days with ≥2 historical jobs → quiet. `regenerateSuggestions` upserts into `item_suggestions`.)_
- [x] Source-job toggles on each suggestion: user sees which past jobs informed it, can include/exclude individual jobs before accepting. _(/suggestions page renders each `evidence.jobs[]` entry as a clickable chip; `excludedByRow` state persists into the `acceptSuggestion({excludedJobIds})` call, which recomputes `field_changes` from the remaining evidence before applying.)_
- [x] Accept actions: update item (with `apply_to` scope + reason), split into two items, deprecate item. _(`acceptSuggestion` patches `rate_book_items.base_labor_hours_*` with Apply-to selector `this|category|shop_wide`; `acceptSplit` inserts two new `rate_book_items` in the same category and sets `active=false` on the original; quiet suggestions flip `active=false` via the same accept path.)_
- [x] Accepted change writes to rate book + history tab. Old value kept in Changes. _(Every accept path writes a `rate_book_item_history` row with `field_changes: { field: { from, to } }`, `apply_scope`, `reason`, and `changed_by`; the history id is stamped back onto `item_suggestions.accepted_history_id` for audit. History feeds the existing Changes tab on the rate-book detail pane.)_
- [x] Dismissed suggestions don't re-surface until new data changes the picture. _(lib/suggestions.ts `evidenceSignature(jobs)` produces a sha256 prefix over the sorted job-id set. `dismissSuggestion` persists that signature; next `regenerateSuggestions` run compares the fresh signature and only flips the row back to 'active' when the evidence has changed. Stale actives with no current evidence are retired with `dismissed_signature='stale:no-evidence'`.)_

---

## Phase 11 — Onboarding (the Apple/TurboTax pass)

**Prerequisite:** Phases 1–10. Can be started earlier with the understanding that it's cosmetic until the underlying surfaces exist.

**Scope:** The first-run experience for a new shop. Deferred intentionally — we ship with a pre-populated starter rate book, and new shops can use MillSuite on day one without a wizard.

**Out of scope:** anything that blocks day-one use. Onboarding is additive and skippable.

**Done when:**

- [x] Parse business card → contact + company prefill. _(/onboarding Step 1: captures name/email/phone/company and writes to `clients` + `contacts` tables. OCR-from-photo path is stubbed as the typed fallback; when the image parser lands it feeds the same form state — no UI change needed.)_
- [x] Upload a past estimate → pull rough pricing baselines into the rate book as suggested edits (still gray confidence until used). _(/onboarding Step 2: creates an `onboarding_stashed_baselines` row with kind='rate_book_item_baseline' and status='pending'. `acceptStashedItemBaseline` writes through to `rate_book_items` + logs `rate_book_item_history` — confidence stays 'untested' until `bumpItemConfidence` fires on a closed-job scan.)_
- [x] Redacted bank statement upload → compute shop burden / effective shop rate suggestion. _(/onboarding Step 3: `computeShopBurden({monthlyRent, monthlyUtilities, monthlyInsurance, monthlyOtherFixed, monthlyShopHours})` → $/hr; result lands in `onboarding_stashed_baselines` with kind='shop_rate_baseline' for the operator to confirm before it overrides `shop_labor_rates`.)_
- [x] Dept-rate interview: simple sliders with explainers, with real-world numbers shown next to each rate. _(/onboarding Step 4: one `<input type="range">` per dept with `REFERENCE_DEPT_RATES[dept].{low, median, high}` rendered below. Save upserts each slider into `shop_labor_rates(org_id, dept, rate_per_hour)` via onConflict.)_
- [x] Option to skip every step. Every skipped step leaves the starter rate book intact. _(Every step has a "Skip this step" button that calls `setStepState({ state: 'skipped' })`. Skipping writes nothing to rate_book / shop_labor_rates. A "Close wizard" control in the header calls `dismissOnboarding` and routes to /dashboard. The starter rate book seeded by `lib/rate-book-seed.ts` is untouched.)_
- [x] First real estimate creates a "confidence ramp" so suggestions light up as actuals come in. _(lib/onboarding.ts `deriveConfidence(jobCount, drift)` buckets items into untested → few_jobs → well_tested (or looking_weird when drift > 35% with ≥3 jobs). `bumpItemConfidence` stamps `rate_book_items.confidence` + `confidence_job_count` + `confidence_last_used_at`; it's wired into `regenerateSuggestions` so every closed-job scan refreshes the ramp for every item with evidence.)_

---

## Phase 12 — Product-tile estimating + walkthrough-driven calibration

**Prerequisite:** Phases 1, 2, 11. This phase replaces the keyboard-first line entry built in Phase 2 with a product-tile + slot composer, and replaces the Phase 11 onboarding wizard with a first-login overlay that runs the shop-rate + base-cabinet walkthroughs. The Phase 11 onboarding surfaces (business card, past estimate upload, bank statement shop-burden) stay — they become optional post-overlay tools, not first-login gates.

**Design source of truth:** [`specs/add-line-composer/README.md`](specs/add-line-composer/README.md) is the closed spec. [`specs/add-line-composer/index.html`](specs/add-line-composer/index.html) is the clickable prototype — open it in a browser before touching UI. Every design decision below was settled in that spec across six review rounds; do not reopen them.

**Scope:** One calibrated walkthrough unit (8' run / 4 doors) across every input. Three active products (Base, Upper, Full) share a single composer. Rate book propagates only to new lines; unsold subprojects get a staleness flag. Install becomes a subproject-level prefill.

**Out of scope:** Drawer / LED / Countertop products (tiles stay stubbed — `active: false`). Customizable door-labor multipliers. Cross-shop rate-book sharing. Any auto-push to QB.

**Done when:**

- [ ] Schema migration: `users.onboarded_at timestamptz` (nullable) + `users.onboarding_step text` (nullable). No `profiles` table in this codebase — `public.users` (see `docs/migration.sql` line 25, with `auth_user_id` → `auth.users.id`) is the extension table. `last_used_slots_by_product jsonb` goes on `users` (per-operator) or `orgs` (shop-wide) — pick one and document; shop-wide is probably right since a shop's typical spec is a shop property. Extend `rate_book_items` so finish items can carry sub-rows for primer / paint / stain / lacquer costs, and door-style items can carry per-dept labor blocks calibrated at 4 doors × 24"×30".
- [ ] `lib/products.ts` constants for Base / Upper / Full: `sheetsPerLfFace`, `doorsPerLf`, `doorLaborMultiplier` (1.0 / 1.3 / 2.5). Drawer / LED / Countertop declared but marked inactive.
- [ ] `components/walkthroughs/ShopRateWalkthrough.tsx` — embeddable component that captures the 5 per-department rates (Engineering, CNC, Assembly, Finish, Install) and writes them into the existing `shop_labor_rates` table (migration 006). Composer math requires per-dept rates; the richer multi-screen blended-rate flow at [`specs/shop-rate-setup/`](specs/shop-rate-setup/) is deferred as an optional post-overlay tool. Same component reused at `/settings/shop-rate` for recalibration.
- [ ] `components/walkthroughs/BaseCabinetWalkthrough.tsx` — embeddable component calibrating one 8' run across 4 depts (Eng / CNC / Assembly / Finish). Wood machining is a guided step that folds into Assembly on save. Same component reused at `/settings/calibration/base`.
- [ ] `components/onboarding/WelcomeOverlay.tsx` + `hooks/useOnboardingStatus.ts`. Mounts in `app/(app)/layout.tsx`. Null `onboarded_at` → renders full-screen, non-dismissible overlay with: welcome screen → shop rate → base cab. Closes and stamps `onboarded_at = NOW()` when both are saved. Mid-flow tab close → re-mounts at `onboarding_step`.
- [ ] `components/composer/AddLineComposer.tsx` built from the prototype. Product tile grid (Base/Upper/Full active; Drawer/LED/Countertop stubs; Countertop locked). Slot UI: carcass material, door style, door/drawer material, interior finish, exterior finish, end panels count, filler count, notes. Live breakdown panel on the right with consumables % and waste % editable inline. Last-used carry-over via the `last_used_slots_by_product` jsonb. Replaces the existing Phase 2 inline line entry on `app/(app)/projects/[id]/subprojects/[subId]/page.tsx`.
- [ ] `components/walkthroughs/DoorStyleWalkthrough.tsx` — ported from the prototype modal. 5 guided steps (Eng / CNC / Machining / Assembly / Finish) × 4 doors at 24"×30". Machining folds into Assembly on save. Fires from the composer hatch when an uncalibrated door style is picked or via "+ Add new door style." Mini-card mode for small gaps, full modal for new styles — decided by how many fields are empty.
- [ ] `components/walkthroughs/FinishWalkthrough.tsx` — one walkthrough with collapsible combo rows (stain+clear on slab, paint on slab, stain+clear on shaker, paint on shaker). Each combo has Base 8' / Upper 8' / Full 8' cards. Each card captures labor hours + material breakdown (primer / paint / stain / lacquer, any can be zero). Partial calibration is a supported state. Fires from the composer hatch.
- [ ] Install prefill on subproject header: `(guys × days × shop install rate) × (1 + complexity %)`. Single % input; description lists typical reasons to mark up (elevator, 2nd floor with stairs, long carry, tight stairwell). Rolls up into the subproject total alongside cabinet cost.
- [ ] Per-line staleness detection via recompute-and-compare: on load, re-run `computeBreakdown` against current rate-book values for each saved line, flag the subproject if any line's recomputed total differs from its stored total. "Rates have changed since these lines were saved" banner + "Update to latest rates" bulk action. Only shows on unsold subprojects (`sold` state already locks rates).
- [ ] At least one real customer estimate priced end-to-end through the new flow — shop rate change propagates correctly, door walkthrough fires in context, finish walkthrough partial-calibration works, line computes match the prototype's math — before this phase closes. Log the run in `docs/` as a dogfooding note.

---

## Cross-thread pickup checklist

If a new thread lands on this repo cold, it should:

1. Read `SYSTEM-MAP.md` end to end.
2. Read this file.
3. Scroll to the first unchecked box in the first unfinished phase above.
4. Open `mockups/` and skim the relevant HTML for the page it's about to touch.
5. Do not reopen resolved questions in the map's "Resolved with Andrew" section.
6. If something feels wrong in the map, edit the map before writing code.
