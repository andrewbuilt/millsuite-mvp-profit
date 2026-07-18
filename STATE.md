# STATE.md

> The one living doc. Top = where things actually stand. Bottom = what's next.
> Rewrite this at the end of every session (see ritual in `CLAUDE.md`). Keep it lean —
> delete finished items, don't archive them here.

**Last updated:** 2026-07-17 · **Branch:** `main`

---

## Where things stand

MillSuite is live and in use. Estimating (rate book, composer, project rollup), scheduling, capacity calendar, invoicing, and Stripe billing are all shipped. Two beta testers are on it.

**Estimates + invoices rebuild — DONE & live (2026-06-19).** Migrations **057–061** run on prod; all commits pushed to `main`. The model now:
- **Estimates** live in MillSuite, delivered as a **branded PDF** ("Send estimate" → download + copy-email; no email infra). Never pushed to QB. (`components/estimates/EstimatePdf.tsx` + `app/api/estimates/[projectId]/pdf` + `SendEstimateModal`.)
- **One invoice per project = the contract** (`bid_total`, estimate line items, milestones as a payment-terms schedule). QB mode pushes it to QB **and** records a matching MillSuite invoice (`client_invoices.qbo_invoice_id` link); internal mode creates it in MillSuite. **Draws** (any amount) lower the balance; the **QB watcher** (`lib/qb-events.ts`) applies incoming payments to the invoice. **Milestones are projection-only** (no longer flip to "received"); dashboard AR reads the invoice balance.
- **QB OAuth/connect** (per-org tokens) live — Andrew connected to Built LLC. Estimate→QB push retired; per-milestone invoicing replaced by the one invoice.

Remaining from this item: **Change Orders** — now **parked** (see "Parked — resume later").

**Top nav shipped (2026-06-19).** Replaced the top bar with a **hoisted** nav — `components/top-nav.tsx`, rendered once in `app/(app)/layout.tsx`; **text-only (no icons)**, 3 grouped dropdowns: **Sales** (click → /sales; hover → Kanban/Invoices/Clients) · **Projects** (click → /projects; hover → Schedule/Capacity) · **Manage** (dropdown-only: Reports/Suggestions/Rate book/Team/Time). Same `hasAccess` gating; member→Time; Invoices plan-gated only. (We tried a slide-out drawer first — Andrew preferred the top bar.) **Cleanup done (2026-06-22):** removed the `import Nav`/`<Nav/>` from all 20 pages and deleted the `components/nav.tsx` stub — nav now lives solely in `app/(app)/layout.tsx` via `components/top-nav.tsx`. (tsc clean; grep for `@/components/nav`/`<Nav/>` under `app/` empty.)

**Projects dashboard + production lifecycle — shipped 2026-06-23.** No schema change. **(A) Lifecycle:** `sold` relabeled **"Pre-Production"**, `production` → **"In Production"**; "Ready for production" is a **derived** sub-state (not a stored stage). Auto-advance is gone — `lib/project-stage.ts` now exposes `isReadyForProduction()` (read-only gate) + `startProduction()` (the sole writer: flips stage + seeds allocations). Production starts **manually** via a readiness-gated "Start production" button + a green Ready banner on the project page; the status-bar Pre-Production pip green-checks when ready. **Deposit signal resolved:** the contract invoice's `amount_received > 0` (post-rebuild, milestones only flip to "received" on full payment, so the old milestone gate was dead). **(B) `/projects` dashboard:** rebuilt as the post-sold view — 5 derived buckets (Pre-production / Ready / In production / Installed / Complete) + client/project search + 3 filter-driven metrics (Value / Est hrs / Tracked hrs). Commits `317d9c9` (A) + `1df7eef` (B). _Made it the main `/projects` index (the open decision). Dropped the old per-card delete (not in the prototype) — say if you want it back. Per-project hours load is N parallel calls (fine at beta scale). End-to-end QA on a real sold project still pending._

**Capacity calendar redesign — shipped 2026-07-16.** `/capacity` is now a **standalone birdseye planning tool**, no longer a mirror of `/schedule`. All in `app/(app)/capacity/page.tsx`; the side pane is unchanged. 5 commits on `main`:
- **Cut the schedule connection fully** (`edd02e7`) — deleted `lib/capacity-seed.ts`; removed every `autoSeedProjectMonthAllocations`/`triggerAutoSeedCapacity` call from `schedule/page.tsx` + `lib/schedule-seed.ts`; stripped the `source` auto/manual concept (auto badge, "Pin to this month" + `pinAllocation`, all `source:'manual'` writes). The `source` DB column stays (defaults `'manual'`, no migration); all rows read as manual.
- **Rolling 12-month window + layout rebuild** (`a940991`) — replaced the year-picker + quarter/half/year zoom with a rolling window (current month + next 11, arrows page ±1, `Today` jump; crosses the year boundary). Fixed-width 184px month columns in one horizontal scroll row; unscheduled tray moved **above** the months (drop-to-unschedule); 12-cell util heat strip (click scrolls a month into view); header stats (Next opening + lead time / Booked / Staffing signal); month card keeps the tiny 3px dept-stacked bar, the 6-row per-dept mini-bar block deleted; ProjectCard collapsed from 3 zoom variants to one.
- **Quiet PTO/holiday line** (`56c3e7e`) — replaced the 🏛/🏖 chips + per-day flag strip with one muted "N holidays · N PTO days" line (dates + names in the tooltip); deleted `MonthOverrideFlags`.
- **Pipeline toggle** (`2b461fb`) — "Sold only" (default) vs "Sold + pipeline". Pipeline (`new_lead`/`fifty_fifty`/`ninety_percent`) cards render dashed + a stage badge; their hours fold into utilization/bars/lead-time/staffing (and a lighter 2nd bar segment) **only when the toggle is on** — off = hidden but persisted. "Booked" stays sold-only in both modes.

Verified: tsc clean; grep `capacity-seed|autoSeed|source.*auto|pinAllocation` under `app/`+`lib/` empty; `/capacity` compiles (200). _**Left for Andrew: interactive QA in the logged-in app** (preview can't auth) — drag sold + pipeline on/off months, confirm the toggle flips the math, the rolling window crosses Dec→Jan, and Even + Smart splits still work (covers the outstanding Smart-split QA)._

**Capacity 0h-capacity bug — fixed 2026-07-17** (`95135dd`). Every month read **0h capacity** because `/capacity` still queried the legacy dept-members join table, which `/team` stopped writing in the shop-rate PR — assignments now live on `team_members.dept_assignments` (jsonb), the source `/schedule` already reads. Fix: derive per-dept billable headcount from `loadShopRateSetup().team` (billable members whose `dept_assignments` include the dept), dropping the dept-members query + `deptMembers` state. Hardened the zero-capacity case so cap=0 never reads as a healthy 0%: a month with hours but no capacity is treated as "over" (heat red, staffing counts it, next-opening skips it, bar clamps to 100%); an empty month reads neutral gray, not green; and a whole window with no capacity shows a warning banner (→ /team, page not gated) + a "No team capacity set up" staffing signal. tsc clean; grep `department_members` under `app/(app)/capacity/` empty; `/capacity` compiles (200). _Still wants Andrew's live-app confirm that real numbers show (≈ billable × 8h × ~21d per dept)._

**Team + shop rate + worker time app — built 2026-07-17 (chunks A–D).** All tsc-clean; every route compiles (200). 8 commits on `main`:
- **A1 member depth + per-person hours** (`b8eca02`) — extended `orgs.team_members` jsonb (email/phone/title/start_date/hours_per_week/active, all backfilled) + /team edit pane. Per-person `hours_per_week` now drives the shop-rate denominator (`sumBillableHoursYear`) and per-dept capacity (`deptDailyHoursByTeam` = Σ hours_per_week/5); `/capacity` + `/schedule` read it in place of headcount × dept.hours_per_day (40h/wk = 8h/day, so seeded depts unchanged). Inactive members drop out of both. _The onboarding walkthrough + settings still show the uniform `computeBillableHoursYear` figure (equal at default) — fold to per-person later._
- **A2 accounts** (`14021d6`) — owner-only `POST /api/admin/users` (service-role, Bearer-verified, org-scoped): create_login (seat-checked, creates auth user + users row, rollback on failure) / reset_password / unlink. /team AccountControls write the returned `user_id` onto `team_members` — the one explicit roster→login bridge.
- **A3 role landing** (`befc515`) — RoleGate confines members to `/me` (was `/time`); top-nav "My work" → /me; minimal `/me` skeleton (D filled it).
- **B PTO** (`74e1e3a`) — **migration `062_pto.sql` (idempotent) MUST run on prod before deploy** (pto_requests + pto_policies, org-scoped RLS). `lib/pto.ts` + /team Time-off section (approve/deny queue, tenure-band policy editor, per-member balance bar). Approve writes one `capacity_overrides` row per weekday (hours_reduction = member's daily hours); deny/delete clears them. /team load is guarded so it renders even if 062 hasn't run.
- **C shop-rate extras** (`7ac13cb`) — no migration (reuses `shop_rate_snapshots` from 001). /team margin ladder (break-even + 15/20/25/30%), snapshot on "Save…", margin alert strip (active jobs under break-even × 1.15).
- **D worker app** (`0a60940`) — no new migration (running timer = `time_entries` with null `ended_at`). `lib/worker-time.ts` + `/me` bottom-tab app: Today (tap-to-clock-in/switch/out, live timer, other-work picker), My week, Time off (request form → /team), History (edit/delete). Admin `/time` already reads the same rows.

Follow-ups since (2026-07-17):
- **Onboarding-overlay fix** (`2927c95`) — the owner WelcomeOverlay (shop-rate/base-cabinet walkthrough) was popping over the `/me` worker app because new worker `users` rows have `onboarded_at` NULL. Role-gated the overlay to non-members + stamp `onboarded_at` when creating a worker login.
- **Org vanity URLs** (`ea89d4e` + `0369bab`) — shop-branded logins keyed on org `slug`: **`millsuite.com/{shop}`** = manager/owner login → full app; **`millsuite.com/{shop}/portal`** = employee login → `/me`. Both share `components/shop-login.tsx` (variant manager|employee); RoleGate still routes by role. auth-context treats any non-reserved top-level segment as a public shop-login path (reserved set = the real app/marketing routes). Verified in the running app: `/built` + `/built/portal` render the "Built" login and cross-link. _App domain is **millsuite.com** (NOT tools.millsuite.com — that's a separate free-tool site). Removed the stale `tools.millsuite.com/dashboard` "Shop Rate" shortcut from the top-nav (`d0af19c`); the two marketing-landing references to the free tool are intentional and kept._

_Migration `062_pto.sql` **run on prod 2026-07-17** (verified: `pto_requests`/`pto_policies` queryable, default policy seeded). **Left for Andrew:** end-to-end QA in the logged-in app — create a worker login on /team, sign in via `/{slug}/portal` on a phone, land on /me, clock in/switch/out, request PTO → approve on /team → day blocks on /capacity + /schedule, confirm per-person hours move the derived shop rate. Note: a worker login consumes a seat (same gate as /join)._

---

## Now

### Projects dashboard + lifecycle — QA fixes  _(found 2026-06-23 in live QA)_

**Deposit → Ready: the invoice is the money truth; both QB and manual feed it.** (Andrew's intent: the *correct* path is QB sees the payment → watcher applies it → project goes Ready; plus a *manual* mark for testing / payments taken outside QB. **Keep the deposit gate on the invoice's `amount_received` — do NOT gate on milestone status.**)

1. **Automatic path (correct, primary) — verify it works end-to-end.** QB watcher applies a QB payment to the project's contract invoice → `amount_received` rises → `isReadyForProduction` (deposit gate = invoice `amount_received > 0`, `lib/project-stage.ts`) true → Ready (green banner + status-bar chip + Start-production button). Confirm the full chain: invoice pushed to QB → QB payment → watcher → `amount_received` → Ready UI → Start → `production` + allocations seeded.

2. **Manual path (testing + outside-QB) — the bug + fix.** Today the operator marks payment **milestones** received on the project page, but `markMilestoneReceived` → `syncInvoiceFromMilestoneReceived` **no-ops when no contract invoice exists** (`findInvoiceForMilestone` → null), so `amount_received` stays 0 and the project never goes Ready (Andrew marked Deposit RECEIVED, banner still said "awaiting deposit"). Make the manual mark feed the invoice signal:
   - **Auto-create the contract invoice when the project is sold** (the one-invoice-per-project; also the existing "auto-seed Create project invoice" follow-up) so there's always an invoice to record against.
   - **Add a one-click "Mark deposit received" (manual)** on the project page that records a deposit payment on the contract invoice via `recordInvoicePayment` → `amount_received` up → Ready. (Auto-create the invoice if still missing.) This is the manual equivalent of the QB watcher — what Andrew uses to test.
   - Make the milestone "RECEIVED" toggle consistent — flipping it manually should record the invoice payment, not just set milestone `status`; no dead toggles.
   - Fix the now-wrong comment in `project-stage.ts` ("the manual `markMilestoneReceived` path raises `amount_received`" — only true once an invoice exists).

3. **Dashboard cards missing the progress bar** from the approved prototype — cards show "X of N subprojects ready" text but no bar (`app/(app)/projects/page.tsx`). Add the thin bar under the context line: pre/ready = readySubs/totalSubs; production/installed = tracked/est; complete = full.

**Verify:** (a) a QB payment on the contract invoice flips the project to Ready automatically; (b) the manual "Mark deposit received" does the same without QB (auto-creating the invoice if needed) — green banner + chip + Start button appear, dashboard moves it to **Ready for production**, Start → In Production + allocations seeded; (c) cards render the progress bar.

_(Capacity 0h-capacity bug — **fixed 2026-07-17** (`95135dd`), moved to "Where things stand." Rest of the capacity redesign shipped 2026-07-16; interactive drag/split/toggle QA still pending Andrew, noted there.)_

_(Team + shop rate + worker time app — **built 2026-07-17** (chunks A–D, 8 commits), moved to "Where things stand." **Migration `062_pto.sql` still needs to run on prod**, plus live-app QA — noted there.)_

### Vanity login + worker app — leftovers  _(overlay fix `2927c95` + vanity URLs `ea89d4e`/`0369bab` shipped 2026-07-17; these scoped pieces were NOT built)_

1. **Logo upload:** `orgs.logo_url` (idempotent migration, run on prod first) + upload in Settings (Supabase storage, public-read). Show on the `/{shop}` + `/{shop}/portal` login pages (fallback stays the name initial); reuse later on estimate/invoice PDFs (check `EstimatePdf` for an existing logo source before duplicating).
2. **Slug surfacing:** Settings shows "Your team's sign-in link: millsuite.com/{slug}/portal" with a copy button; same link next to worker-login creation on /team (the "what do I tell my employee" moment).
3. **PWA `start_url` flash (minor):** `app/manifest.ts` still has `start_url: '/dashboard'` — worker home-screen icons flash the dashboard before RoleGate bounces to `/me`. Point it somewhere neutral that forwards by role, or accept the flash.
4. **Org mismatch guard (optional):** signing in on the wrong shop's page should say "this account belongs to a different shop" + link, not silently log into the other org.

**Verify:** logo renders on both login variants; copy-link buttons show the right URL; home-screen icon opens `/me` without visibly hitting the dashboard.

### Built OS → MillSuite data migration, first pass — scoped 2026-07-17 (Cowork planning pass with Andrew)

**Reference:** `../built-os/docs/DATA-MIGRATION-INVENTORY.md` (entity map + verification checklist — still the working map). Two of its open questions are now resolved: **(a) separate Supabase projects confirmed** (different URLs in the two repos' env files → this is an export/import *script*, not in-database SQL); **(b) MillSuite now has a `clients` table** (`client_id` FK + denormalized `client_name`), so Built clients map straight across — no flatten-onto-projects.

**Decisions locked with Andrew:** history = **active + snapshots** (open leads + active/sold projects fully editable; completed jobs read-only with frozen totals — don't re-model old estimates). Estimates = **auto-translate + verify** (script converts, then compares per-project totals + dept hours to Built's; mismatches flagged for hand-fix in the composer, not force-fitted). First pass includes **payment milestones**; explicitly OUT of this pass: time entries, drawing links, schedule state (re-seed from estimate hours after landing), vendors/materials/rate-book seeding, QB relink, pre-production selections. Lost leads: skip, log the count.

**Progress (2026-07-18):** **chunks 1–2 built + chunk-1 export run** (`92a1de5`, `a1f842e`). `scripts/migrate-built/` scaffold (env → both Supabase clients, CLI `--dry-run/--entity/--project/--limit`, `id-map.ts` upsert-through-map, `migrate.ts` pipeline with chunk 3–5 stubs, `dump-schema.ts`) + migration **`063_migration_id_map.sql`** (migration_id_map + `projects.built_archive`). Built creds wired into gitignored `scripts/migrate-built/.env` from Built's own `.env.local`; MillSuite creds from `.env.local`. **Schema snapshot committed** (`scripts/migrate-built/schema-snapshot/`): counts — clients 62, leads 87, lead_subprojects 358, projects 15, subprojects 53, cash_flow (milestones) 81; `milestone_instances`/`estimate_line_items` don't exist. **All 53 subprojects are v4** (`spec_lines_json`; zero flat-v1); each line carries a `dept_hours {engineering,cnc,assembly,finish,install}` map → clean for chunk-4 translation + verify. _supabase-js gotcha (fixed in preflight): a head/count query does NOT error on a missing table — use a real select._ **`063_migration_id_map.sql` run on prod 2026-07-18** (verified: `migration_id_map` + `projects.built_archive` exist; `migrate.ts --dry-run` passes preflight, resolves the target org, and runs the full stubbed pipeline). **Chunk 3 built + test-pass verified 2026-07-18** (`4db78e6`): `entities.ts` migrates clients → projects (Built leads[open/non-lost/non-converted] + projects, stage-mapped) → subprojects → milestones (`payment_terms.milestones` → `cash_flow_receivables`), all through the id map. Full dry-run reconciles (62 clients, 85 projects, 352 subprojects, 223 milestones). **Live `--project` test pass ran on 3 jobs** (via a terminal session with the `Bash(npx tsx scripts/migrate-built/migrate.ts:*)` allow rule — this desktop session can't self-write to prod) and **verified against the live DB**: _Arnold Primary Closet_ pre_production→**sold** $95,842 (4 subs), _DPR – AHT Sim Lab_ **fifty_fifty** $57,415 (8 subs, 4 milestones), _Pendry Model Display_ complete→**installed** $4,865 (2 subs). id_map: 3 clients/3 projects/14 subs; stage mapping, client links, bid_total, milestones all correct. **Next: Andrew eyeballs the 3 in the UI (sales kanban / project page / milestones) + signs off, then chunk 4** (estimate translation — `spec_lines_json` → `estimate_lines` + per-project verify). Chunks 4–6 remain; the script targets the **live** org. _Running the migration from this desktop session is blocked by the harness (prod-write self-authorization) — run via the terminal Claude session that has the allow rule, or a plain terminal._

**Build (each numbered chunk = commit set):**

1. **Export the live Built OS schema first** (the inventory's warning stands: Built has no migration files — schema lives in its Supabase dashboard). Dump `information_schema` for the in-scope tables (clients, leads + lead subprojects, projects, subprojects, milestones) via the Built service key; save to `scripts/migrate-built/schema-snapshot/`. Confirm the estimate format split per subproject: `spec_lines_json` (v4, trust) vs `pricing_lines_json` (v2) vs flat v1 fields — do NOT read `assembly_lines_json` (v3 engine was deleted).
2. **Script scaffold** `scripts/migrate-built/` (TS, run via tsx; env: `BUILT_SUPABASE_URL/SERVICE_KEY`, `MILLSUITE_SUPABASE_URL/SERVICE_KEY`, `TARGET_ORG_SLUG=built`). One idempotent MillSuite migration adds `migration_id_map` (org_id, entity, built_id, millsuite_id, unique(entity, built_id)) — every write upserts through the map so re-runs update instead of duplicate. Flags: `--dry-run` (prints plan, writes nothing), `--entity <name>`, `--project <built-id>` (single-project test), `--limit N`.
3. **Order + stage mapping:** clients → projects (Built `leads` AND Built `projects` both land in MillSuite `projects` — the stage names `new_lead`/`fifty_fifty`/`ninety_percent`/`sold` already match 1:1; Built post-sold statuses map onto MillSuite's lifecycle: `sold/pre_production` → sold (Pre-Production), `scheduling`/`in_production` → production, installed/complete → installed) → subprojects → estimate lines → milestones (validate each project's milestone %s sum to 100).
4. **Estimate translation (active jobs):** v4 spec lines → `estimate_lines` (map to `product_key`/`product_slots` where clean; otherwise a custom line preserving cost + dept hours; carry dept-hours jsonb into dept-hour overrides). v2/v1 rows → one custom line with the stored totals. **Margin guard:** confirm whether Built's stored totals bake markup in; set the MillSuite project margins so `bid_total` equals Built's sold price — never double-apply. **Per-project verify:** `computeSubprojectRollup` total + dept hours vs Built's stored total within ±1%; misses go to a mismatch report + project flagged for composer hand-fix.
5. **Snapshots (completed jobs):** project row with frozen `bid_total`, stage installed/complete, original `spec_lines_json` stashed in an archive jsonb column (add in the same migration as the id map); one summary estimate line; read-only by convention.
6. **Test pass (do this before the full run — Andrew's ask):** `--project` on 2–3 representative jobs — one active v4 job, one open lead, one completed job — into the live org. Andrew eyeballs them in the UI (sales kanban, project page, estimate composer, milestones) and signs off. Then the full run, then the inventory doc's verification checklist (row counts reconcile, FKs resolve through the map, re-run = zero duplicates).

**Cutover** (freeze Built OS writes, archive repo, retire deploy) stays in the inventory doc — only after the full run is verified.

---

## Parked — resume later

### Change Orders — finish the last mile  _(estimates+invoices rebuild landed & live 2026-06-19; this is what's left of the item)_

**⏸ PAUSED — Andrew is getting his team's input before we build this.** The review + plan below are ready to resume when he's back. (Key open question from the review: how COs are created/surfaced — the engine is slot/line-seeded from the pre-production page, not a free-form modal — and how an approved CO bills as its own invoice.)

The estimates-in-MillSuite + invoices-to-QB rebuild is **done and live** (see "Where things stand"). The remaining piece is **Change Orders**, which are **~80% already built** — schema `002_preprod_approval_schema.sql` (+ RLS `018`; `client_invoice_line_items.source_type` includes `'change_order'` in `041`), logic `lib/change-orders.ts` (`loadChangeOrdersForProject`/`createChangeOrder`/`approveCo`/`rejectCo`/`voidCo`/`sumApprovedNetChange`), UI `components/change-orders.tsx`, manual billing via `AddLineItemPicker` "From change order". It's just **not mounted on the main project page**.

**Model (locked):** a CO is a separate estimate for added/changed scope, created during production, approved (internal mark), then billed as **its own separate invoice** — never edits the contract invoice. Contract total uses **Option A**: `bid_total` frozen; approved COs shown additively (`sumApprovedNetChange`).

#### Build (commit each)
1. **Surface it** on `app/(app)/projects/[id]/page.tsx`: mount `ChangeOrders` + a free-form "+ New change order", gated to production+ (`!isPresold(stage)`).
2. **Contract-total display (Option A):** "Original contract / + approved COs / = current" via `sumApprovedNetChange(cos)`. Display only; `bid_total` doesn't move.
3. **CO PDF:** clone the estimate PDF (`components/estimates/EstimatePdf.tsx` + `app/api/estimates/[projectId]/pdf`) → `components/changeorders/ChangeOrderPdf.tsx` + `app/api/change-orders/[id]/pdf/route.ts` + `lib/change-order-pdf.ts`; "Download PDF" per CO.
4. **One-click billing on approval:** `buildInvoiceFromChangeOrder(coId)` in `lib/change-orders.ts`. Approved, not-yet-invoiced CO → **Internal:** `CreateInvoiceModal` seeded with the CO line; **QB:** mirror the project-invoice flow (push to QB → record the MillSuite invoice → link `qbo_invoice_id`). Guard void/decline once billed. CO = its own separate invoice; never edits the contract invoice.

Keep simple: internal mark-approved stays (`approveCo()`); don't reuse `lib/approvals.ts` (spec-sample sign-off); leave the slot-seeded spec-CO write-back alone.

**Verify:** create → approve → bills as its own invoice (QB: new QB invoice / internal: prefilled); contract invoice untouched; double-billing blocked; CO total shows additively.

#### Follow-ups from the rebuild (not blockers)
- **Internal-mode "Create project invoice"** still opens the blank builder — auto-seed it with the contract (mirror the QB path / add a `CreateInvoiceModal` `project` mode).
- **Partial draws park for review** (invoice matching is amount/name based). Add exact `qbo_invoice_id` matching in `lib/qb-events.ts` so QB payments linked to the invoice auto-apply to the balance.
- **Dead code:** the old inline `QbPreviewModal` (clipboard estimate) + `buildClipboardText`/`buildDefaultSpec` in the project page are now unreferenced — delete.
- **Estimate/CO PDF layout + logo polish** — fold into the "apply aesthetic" pass.

#### Open decision (CO)
- CO contract total: **Option A** frozen-contract (default, what's built) vs. Option B fold into `bid_total`.

---

## On deck — scoped, not started

### ~~Slide-out side nav~~ → shipped as a TOP NAV (2026-06-19)

**Shipped as a hoisted top bar, not a drawer** (Andrew preferred the top bar) — see "Where things stand" → "Top nav shipped." The drawer spec is **superseded**; nothing left here. (Department-view reorg remains the separate `[ongoing]` item in "Next.")

---

## Next — build-out, in order

These are **intents, not specs.** Each is `[unscoped]` until defined with Andrew in a Cowork
planning pass. **Code: do not build an `[unscoped]` item — bring it back to be scoped first.**
We define one item at a time, just before building it; the spec lands in "Now" while it's active.

**Phase 1 — shell / structure** _(one coherent wave; settle structure before skinning it)_

- `[shipped]` Projects dashboard + production lifecycle (Pre-Production → Ready → In Production) — shipped 2026-06-23 (see "Where things stand")
- `[parked]` Change Orders — paused (Andrew getting team input); spec kept under "Parked — resume later"
- `[shipped]` Top nav (Sales / Projects / Manage) — shipped as a top bar 2026-06-19 (the slide-out drawer was dropped)
- `[ongoing]` Department-view reorg — evolving; Andrew refines it as the team uses the app. Not a fixed spec; revisit in a planning pass when there's real usage signal.
- `[unscoped]` Apply the new aesthetic (design made in Claude design)
- `[unscoped]` Rethink landing page + reports page content

**Phase 2 — feature parity with Built OS** _(build into the finished shell; priority order TBD)_

- `[absorbed]` Connect QuickBooks — done as part of the QB invoicing work (OAuth + push shipped, chunks 1–5).
- `[shipped]` Capacity calendar redesign — **shipped 2026-07-16** (see "Where things stand"): standalone planning tool — schedule auto-seed cut, pipeline toggle, rolling 12-month window, layout rebuild, quiet PTO display. Interactive live-app QA still pending Andrew. Still optional for later: 4-day (Mon–Thu) work-week option, and an alerts surface (`computeAlerts` in `lib/schedule-engine.ts` is unwired).
- `[built]` Employee app → **built 2026-07-17 as "Team + shop rate + worker time app" (chunks A–D; see "Where things stand")** — worker phone app `/me`, team-page depth + accounts + per-person hours, PTO requests/approve, shop-rate extras. Migration `062_pto.sql` **run on prod 2026-07-17**; **pending: live-app QA.** Learning loop (actuals → rate book) deliberately deferred. Built's benefits directory + handbook tabs also deferred (nice-to-have). PWA: manifest is already `standalone`; a worker-specific `start_url`/top-nav-hide is optional polish.
- `[unscoped]` Client portal — match Built OS _(note: portal was deleted from MillSuite early as scope creep — this is a rebuild, not a tweak)_

**Phase 3**

- `[scoped]` Migrate data Built OS → MillSuite → **first pass scoped in "Now" (2026-07-17)**: clients + leads/projects + estimates (auto-translate + verify) + milestones; active + snapshots; test with 2–3 projects before the full run. Inventory: `../built-os/docs/DATA-MIGRATION-INVENTORY.md`. Archive Built OS after cutover.
- `[unscoped]` Org subdomains (`built.millsuite.com`) — the sellable-instance upgrade over the vanity login page (scoped 2026-07-17 in "Now"): middleware resolves subdomain → org, brands login, wildcard DNS + wildcard domain on the host. Scope when a second paying customer is close.

## Open decisions _(resolve when scoping the relevant item)_

- New design format (Figma / HTML / components) — determines how Code consumes it
- Phase 2 priority order

---

## Watch out for

- Latest DB migration is `061` (057–061 = the invoicing rebuild; all run on prod). Run any new migration against prod Supabase before deploying.
- QB mode = **estimates stay in MillSuite (PDF); one project invoice pushes to QB** (estimate→QB push and per-milestone invoicing are retired). If a stray "we never send to QuickBooks" line turns up anywhere, clean it up.
- **Production is a manual step** (shipped 2026-06-23) — `sold → production` no longer auto-advances; the readiness-gated "Start production" button (project page + Ready banner) is the only path, and it's the only thing that seeds schedule allocations. Existing `production` projects unaffected. "Ready for production" is **derived**, not a stored stage. **Deposit signal** = the contract invoice's `amount_received > 0` (not a milestone flipped to "received").
- **Latest DB migration is `063`** (`063_migration_id_map.sql`, Built OS migration id map + `projects.built_archive` — **run on prod 2026-07-18**; `062_pto.sql` PTO ran 2026-07-17). Run any new migration against prod Supabase before deploying.
- **supabase-js gotcha:** a `.select(..., { head: true, count: 'exact' })` query returns `{ error: null, count: null }` for a **missing** table (no error) — use a real non-head select to detect table existence (see `scripts/migrate-built/migrate.ts` preflight).
- **Per-person `hours_per_week` drives capacity + the shop rate now** (chunk A1) — `deptDailyHoursByTeam` (Σ members' hours_per_week/5) replaced headcount × dept.hours_per_day in `/capacity` + `/schedule`; `sumBillableHoursYear` replaced the uniform denominator in `computeDerivedShopRate`. 40h/wk = 8h/day so seeded 8h depts are unchanged; `dept.hours_per_day` is no longer the capacity multiplier. Inactive members drop out of both.
- **Worker logins consume a seat** (chunk A2) — creating a login on /team hits the same seat gate as /join; if at the limit it 402s. Members (role='member') are confined to `/me` by RoleGate.
- **`/capacity` and `/schedule` are now decoupled** (redesign, 2026-07-16) — editing the schedule no longer writes `project_month_allocations`; the capacity calendar is manual drag-drop only. The `source` column still exists on `project_month_allocations` (defaults `'manual'`) but nothing reads it. `lib/capacity-seed.ts` is gone.
- `../built-os` is frozen — don't build features there (but it's the **reference** for the QB port).
