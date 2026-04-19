# BUILD-PLAN.md — pre-prod approval system

**Scope:** the post-sold material + finish approval surface captured in `/mnt/code/built-os/preprod-approval-mockup.html`.
**Companion docs:** `STATE.md` (repo state), `/mnt/code/built-os/product-strategy-notes.md` (strategy), the eight mockups in `/mnt/code/built-os/` (design).
**Read order for the next thread:** strategy notes → STATE.md → this file → the preprod-approval mockup → the other mockups as needed.

---

## 1. System audit — is this closed-loop?

Short answer: **the loop is closed inside the approval surface, but it hands off to a human at both ends.** That's intentional for V1. The next thread needs to respect those hand-offs and not quietly add automation.

### Upstream interfaces (what feeds approvals)

| Source | What flows in | Mechanism |
|---|---|---|
| **Estimate lines** (`subproject-editor-mockup.html`) | The set of items that need approval. Whatever the estimator flagged on a line becomes a spec slot. | `approval_items` rows created from flagged estimate lines on sold. |
| **Rate book** (`rate-book-mockup.html`) | Material + finish options, labor hrs/LF per material, material cost per material. Feeds both the initial slot values and the CO repricing diff. | Slot holds `rate_book_item_id` + chosen material/finish. Custom slots bypass this. |
| **Sold handoff** (`sold-handoff-mockup.html`) | The moment approvals are created. Selections snapshot + schedule placeholder + QB deposit. | "Mark as sold" is the trigger that instantiates `approval_items` for the project. |
| **Drawings** | Revision uploads (V1: manual upload, not Drive-folder-heuristic). | `drawing_revisions` table; user clicks "Upload revision," system does not infer. |

### Downstream interfaces (what approvals feed)

| Target | What flows out | Mechanism |
|---|---|---|
| **Scheduling** (`app/(app)/schedule`) | Subproject goes to "Ready for scheduling" status only when all slots + all drawings approved. | Computed gate: `subproject.status = 'ready_for_scheduling'` when `all(approval_items.approved) && all(drawings.approved)`. |
| **Production** | No separate signal — scheduling is the production gate. | Same gate as above. |
| **QuickBooks** | Change order amounts. **Manual in V1.** User marks the CO as handed off; system does not push. | `change_orders.qb_handoff_state` + note field. No QB API call in V1. |
| **Project dashboard** | Summary tiles: X of Y slots approved, drawing status, open COs. | Aggregated query over `approval_items`, `drawing_revisions`, `change_orders`. |
| **Suggestions feed** (`suggestions-mockup.html`) | Not yet. Future: "material X gets revised 3x on average — consider confirming finish before estimate." | Deferred to learning loop work. |

### Where the loop closes vs. where a human closes it

Closed inside the product:
- Slot states (pending → review → approved) driven by user action on the page
- Ball-in-court timer (derived from last-action timestamp per slot)
- Gate to "Ready for scheduling" (computed)
- CO estimate-line diff + repricing (computed from rate book)

Closed by a human (V1):
- Sending the CO to the client (email, outside the product)
- Receiving client approval (user marks it manually)
- Updating the QB invoice (user does it; system logs the decision)
- Sample shipment tracking (user enters the date sent / date received)

**Verdict:** closed-loop enough to build. The manual hand-offs are explicit in the mockup; they're not gaps. Phase 6+ tightens them.

---

## 2. Design decisions

The ten blockers from the first pass are resolved. Schema impact below feeds Section 3. Resolved Apr 19 (second session).

**D1 — Flagging lines for approval.** Hybrid model. Rate book items carry `default_callouts text[]` (e.g., "walnut slab cabinet face" → `['exterior material', 'exterior finish']`). Estimate lines carry `callouts text[] nullable` — null inherits the rate book default, non-null overrides. Each callout string becomes the `label` on the resulting `approval_items` slot. Feeds the learning loop: the suggestions feed can nudge default callouts based on what estimators actually flag on real projects.

**D2 — Material variants on the rate book.** Construction stays the same, material swaps. New `rate_book_material_variants` table keyed on `rate_book_item_id`: `material_name`, `material_cost_per_lf`, and per-department labor multipliers (`labor_multiplier_eng/cnc/assembly/finish/install`, all default 1.0). Each item gets a `default_variant_id` so unedited lines pick up a sensible default. CO repricing reads `original.variant_id` + `proposed.variant_id` and diffs against line LF.

**D3 — Invoice pattern for COs.** Default to a separate invoice per CO. `change_orders.qb_handoff_state` enum still carries both (`separate_invoice`, `invoice_edited`) so the user can choose per-CO. V1 stays manual — no QB API call; system logs which way the user handled it.

**D4 — How linked slots get created.** Manual, with smart suggestions. `approval_items.linked_to_item_id uuid nullable` (already in the data model). UI suggests links when a new slot label repeats an existing slot label on the same project; user confirms in one click. No auto-by-convention, no rate-book-declared links.

**D5 — Ball-in-court clock.** Ball flips to client when a slot hits `in_review` or a drawing revision hits `in_review`. Ball flips to shop when the client requests a change (slot back to `pending`) or a new revision is needed. Ball clears on `approved`. Warning chip at 3 days, red at 7. Stored on `approval_items.ball_in_court` + `last_state_change_at` so queries stay cheap.

**D6 — Who approves.** Shop user only in V1. Client approval comes verbally or by email; shop user marks it on the client's behalf. Portal-based client signing is Phase 6+. Cuts all portal scope cleanly out of Phase 0–4.

**D7 — Custom slot schema.** Free text for the labels, structured numbers for the baseline. New fields on `approval_items` for custom slots: `custom_material_cost_per_lf numeric nullable`, `custom_labor_hours_eng/cnc/assembly/finish/install numeric nullable`. If the user skips the baseline at creation time, the CO diff panel refuses to auto-reprice and prompts manual entry. Custom slots with a baseline can promote to rate book items later (Phase 6+, learning loop).

**D8 — Drawing revision model.** One row per revision, no parent `drawings` entity. Add `is_latest bool` (stored, flipped when a new revision uploads — simpler for the gate query than computed) and `uploaded_by_user_id uuid FK`. "Approved" means shop user marked it approved after verbal/email sign-off. Gate uses `is_latest = true AND state = 'approved'`.

**D9 — Clone inheritance.** Cloning a subproject post-sold copies its `approval_items` with state reset to `pending`, `last_state_change_at = now()`, no `item_revisions` history. Linked slots in the source become unlinked in the clone. Drawing revisions do not copy — each subproject gets its own drawing track.

**D10 — CO effect on subproject bid.** Original bid stays frozen at sold. `change_orders.net_change` summed where `state = 'approved'` gives the CO adjustment. Reports expose both: "bid $X, approved COs $Y, current total $X+Y, actual $Z." Matches the MVP's existing bid-vs-actual math; preserves the original contract amount as the legal number.

---

## 3. Data model

Five new tables + column additions on two existing tables. All `id`s are `uuid`, timestamps are `timestamptz`, FKs cascade unless noted.

### Column additions on existing tables

- `rate_book_items.default_callouts text[] not null default '{}'` — per D1. Each string is a slot label.
- `rate_book_items.default_variant_id uuid nullable FK rate_book_material_variants(id)` — per D2.
- `estimate_lines.callouts text[] nullable` — per D1. Null means inherit from the rate book item; non-null array overrides.
- `estimate_lines.rate_book_material_variant_id uuid nullable FK` — per D2. Selected variant on this line. Null = use the item's default variant.

### `rate_book_material_variants`

One row per material option for a rate book item. Construction stays constant on the item; material varies here.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `rate_book_item_id` | uuid FK | |
| `material_name` | text | "White oak rift", "Walnut slab", etc. |
| `material_cost_per_lf` | numeric | |
| `labor_multiplier_eng` | numeric | default 1.0 |
| `labor_multiplier_cnc` | numeric | default 1.0 |
| `labor_multiplier_assembly` | numeric | default 1.0 |
| `labor_multiplier_finish` | numeric | default 1.0 |
| `labor_multiplier_install` | numeric | default 1.0 |
| `created_at`, `updated_at` | timestamptz | |

### `approval_items`

One row per spec slot per subproject.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `subproject_id` | uuid FK | |
| `source_estimate_line_id` | uuid FK nullable | The estimate line this slot was derived from. Null for manual adds. |
| `label` | text | The callout string, e.g. "Cabinet exterior", "Metal toe kick". |
| `rate_book_item_id` | uuid FK nullable | Null for custom slots. |
| `rate_book_material_variant_id` | uuid FK nullable | Selected variant. Null for custom slots. |
| `material` | text | "White oak veneer", "Blackened steel", etc. Denormalized for display + history. |
| `finish` | text | "Rubio Pure", "Matte clear", etc. |
| `is_custom` | bool | true when no rate book match. |
| `custom_material_cost_per_lf` | numeric nullable | Per D7. Used for CO diff on custom slots. |
| `custom_labor_hours_eng` | numeric nullable | Per D7. |
| `custom_labor_hours_cnc` | numeric nullable | Per D7. |
| `custom_labor_hours_assembly` | numeric nullable | Per D7. |
| `custom_labor_hours_finish` | numeric nullable | Per D7. |
| `custom_labor_hours_install` | numeric nullable | Per D7. |
| `linked_to_item_id` | uuid FK nullable (self) | When non-null, this slot inherits from the target. Per D4, created manually via UI suggestion. |
| `state` | enum | `pending` \| `in_review` \| `approved`. |
| `last_state_change_at` | timestamptz | Drives ball-in-court. |
| `ball_in_court` | enum nullable | `client` \| `shop` \| `vendor`. Stored per D5. |
| `created_at`, `updated_at` | timestamptz | |

### `item_revisions`

Audit trail of sample submissions and client responses per slot.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `approval_item_id` | uuid FK | |
| `action` | enum | `submitted` \| `client_requested_change` \| `approved` \| `material_changed`. |
| `note` | text | Free-text context. |
| `actor_user_id` | uuid FK | |
| `occurred_at` | timestamptz | |

### `drawing_revisions`

Parallel track for drawing approvals.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `subproject_id` | uuid FK | |
| `revision_number` | int | 1, 2, 3, … auto-incremented per subproject. |
| `file_url` | text | |
| `state` | enum | `pending` \| `in_review` \| `approved`. Approved = shop user marked it after verbal/email sign-off (D8). |
| `is_latest` | bool | Stored, flipped when a new revision uploads. Used by the scheduling gate. |
| `uploaded_by_user_id` | uuid FK | |
| `submitted_at`, `responded_at` | timestamptz | |
| `notes` | text | |
| `created_at`, `updated_at` | timestamptz | |

### `change_orders`

One row per change order. Linked to the approval item(s) that triggered it.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK | |
| `subproject_id` | uuid FK nullable | |
| `approval_item_id` | uuid FK nullable | The slot that prompted the CO, when applicable. |
| `title` | text | "CO-002 · Island cabinet material change" |
| `original_line_snapshot` | jsonb | Frozen copy of the estimate line being changed. |
| `proposed_line` | jsonb | Proposed replacement. |
| `net_change` | numeric | Positive or negative dollar amount. |
| `no_price_change` | bool | If true, `net_change` is zero and the CO is documentation-only. |
| `state` | enum | `draft` \| `sent_to_client` \| `approved` \| `rejected` \| `void`. |
| `client_response_note` | text | Manual. |
| `qb_handoff_state` | enum | `not_yet` \| `invoice_edited` \| `separate_invoice` \| `not_applicable`. |
| `qb_handoff_note` | text | Manual note, e.g. "Added to invoice #1234 on 4/22." |
| `created_at`, `updated_at` | timestamptz | |

**Gate logic** (view or computed column on `subprojects`):
```
ready_for_scheduling = (
  count(approval_items WHERE state != 'approved') = 0
  AND count(drawing_revisions WHERE state != 'approved' AND is_latest) = 0
)
```

**Clone semantics (D9).** Cloning a subproject post-sold copies its `approval_items` rows with `state = 'pending'`, `last_state_change_at = now()`, no `item_revisions` history. `linked_to_item_id` is nulled in the clone (user can re-link manually). `drawing_revisions` do not copy — each subproject has its own drawings track.

**CO bid math (D10).** Original subproject `bid_amount` is frozen at sold. The subproject's current ceiling for actuals is `bid_amount + sum(change_orders.net_change WHERE state = 'approved' AND subproject_id = self)`. Reports expose both numbers. Never mutate `bid_amount` on an approved CO.

---

## 4. Build plan — six phases

Each phase is a shippable chunk. Don't combine them. Don't skip the schema phase.

### Phase 0 — schema (blocker work, all 10 decisions now resolved)

Migrations:

- New table `rate_book_material_variants` (D2). Backfill a default variant per existing `rate_book_items` row using whatever material info is already on the item; set `rate_book_items.default_variant_id` to point at it.
- New table `approval_items` with custom slot baseline fields (D7), `ball_in_court` stored (D5), `linked_to_item_id` self-FK (D4).
- New table `item_revisions`.
- New table `drawing_revisions` with `is_latest` + `uploaded_by_user_id` (D8).
- New table `change_orders` with `qb_handoff_state` enum carrying both `separate_invoice` and `invoice_edited` (D3).
- Alter `rate_book_items` — add `default_callouts text[]`, `default_variant_id uuid FK` (D1, D2).
- Alter `estimate_lines` — add `callouts text[] nullable`, `rate_book_material_variant_id uuid nullable FK` (D1, D2).

No UI yet. Seed a test subproject with slots that exercise: rate-book-sourced slot, custom slot with baseline, custom slot without baseline, linked pair, pending + in_review + approved states, two drawing revisions (one superseded, one latest). Run the gate query against the seed to confirm it matches expectations.

### Phase 1 — approval items surface on the subproject page

- Render the slot cards from `preprod-approval-mockup.html` against real data.
- Three states, state transitions, timestamps.
- Ball-in-court chip per D5.
- Custom slot support with baseline entry (D7).
- Linked slot support per D4 — manual create, with a suggestion chip when a matching label already exists on the project.
- No CO panel yet. No drawings track yet.

### Phase 2 — drawings track

- Upload revision, list revisions, approve revision.
- Replace any existing "drawings by Drive folder name" heuristic with this.
- Add drawings to the "Ready for scheduling" gate.

### Phase 3 — the gate

- `ready_for_scheduling` computed state on subprojects.
- Show it in the project dashboard + anywhere else status displays.
- Wire scheduling to respect it (can't schedule a subproject that isn't ready).

### Phase 4 — change orders (manual V1)

- CO panel as estimate-line diff against `rate_book_material_variants` (D2).
- CO list per project.
- Repricing logic: `(proposed.variant.material_cost_per_lf * LF) - (original.variant.material_cost_per_lf * LF) + labor deltas via per-department multipliers`. For custom slots, diff against the custom baseline (D7) or prompt manual entry if no baseline is set.
- CO affects subproject total per D10 math — `bid_amount` stays frozen, approved COs are summed separately.
- Manual client-approval marking.
- Manual QB handoff marking per D3 — default pattern is separate invoice per CO; user can toggle per-CO. No QB API call.

### Phase 5 — polish + prune

- Replace the leftover Apr 18 scaffolding that contradicts this model: separate `leads`/`lead_subprojects` tables, the standalone pre-production page, the static estimate page, the Built-OS-clone Selection schema.
- Retain what's salvageable (rate book shell, Kanban UI, Klaviyo/email libs, checkout, role gate).
- Reconcile the other mockups (see section 5).

### Phase 6+ — automation

Not V1. Tracked so they don't sneak in early:
- Portal signatures on COs
- Auto-email nudges for stale ball-in-court
- QB API push
- Learning-loop suggestions against approval revision counts

---

## 5. Mockups that need resync

The preprod approval mockup changed the shape of four other mockups. These should be updated before (or alongside) the build.

| Mockup | What changes |
|---|---|
| `sold-handoff-mockup.html` | Strategy doc already tagged this "partially wrong." Rebuild it against the approval model: selection cards become seed data for `approval_items`; handoff confirms the slot list the estimator tagged; QB deposit block stays; drawings track gets a preview. |
| `subproject-editor-mockup.html` | Add the "needs approval" flag on estimate lines (resolves question 1 visually). Show how the estimator decides what gets a slot. |
| `project-rollup-mockup.html` | Summary tiles need to reflect the approval gate: "X of Y slots approved," "N drawings pending," "M open COs." QB preview modal is fine as-is. |
| `rate-book-mockup.html` | Add material variants (question 2) if we decide variants live here. Add whatever surfaces "this item has N approval callouts by default" (question 1 if it lives here). |

---

## 6. Stop / ask list for the next thread

If any of these happen, pause and check with Andrew:

- You're about to build a portal surface that accepts client signatures on COs. **Stop.** V1 is manual.
- You're about to wire an email send (Klaviyo or otherwise) off an approval action. **Stop.** V1 is manual.
- You're about to call the QB API to push a CO amount or edit an invoice. **Stop.** V1 is manual.
- You're about to infer drawing revision status from a Drive folder name. **Stop.** That's the pattern we're killing.
- You're about to scaffold a separate `leads` table or a separate `selections` table with Built-OS statuses (`unconfirmed → pending_review → confirmed → voided`). **Stop.** See STATE.md — that's the Apr 18 misread.
- You're about to add a fixed-slot template per subproject type ("main kitchen always gets 3 slots"). **Stop.** Slots come from estimate callouts.
- You can't resolve one of the ten open questions. **Stop and ask** — don't invent an answer.

---

## 7. Rules from STATE.md still apply

- The eight mockups are the spec. The strategy doc's "Repo reality check" section describes Built OS; it's reference, not a build target.
- Language: "%" not "points", "difference" not "delta", "commits/starts/goes live" not "fires", labor in hours first, whole-number percentages.
- Harvest is a competitor. Never recommend integrating it.
- When in doubt, stop and ask.
