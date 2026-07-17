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
- **Employee vanity URL** (`ea89d4e`) — shop-branded worker login at **`millsuite.com/{shopname}/portal`** (`{shopname}` = org `slug`), mirroring `/join/[slug]`. Root `[shop]/portal` only matches two-segment paths; static routes still win; `/*/portal` is public in auth-context. _App domain is **millsuite.com** (NOT tools.millsuite.com — that's a different site; the top-nav still hard-codes a `tools.millsuite.com/dashboard` external shortcut for starter plans → likely stale, clean up later). The bare `millsuite.com/{shopname}` route Andrew mentioned is NOT built — separate scope (what does that page show?)._

_**Left for Andrew:** (1) **run migration `062_pto.sql` on prod Supabase** — I can't (no CLI/psql/connection here; service key only speaks PostgREST). Paste `db/migrations/062_pto.sql` into the Supabase SQL editor and run; it's idempotent. (2) end-to-end QA in the logged-in app — create a worker login on /team, sign in via `/{slug}/portal` on a phone, land on /me, clock in/switch/out, request PTO → approve on /team → day blocks on /capacity + /schedule, confirm per-person hours move the derived shop rate. Note: a worker login consumes a seat (same gate as /join)._

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

### Worker time app — QA fixes  _(found 2026-07-17, Andrew testing with a fake employee login)_

1. **Workers get the owner onboarding wizard.** `components/onboarding/WelcomeOverlay.tsx` is mounted for everyone in `app/(app)/layout.tsx` and shows whenever `users.onboarded_at` is null — no role check — so a fresh member-role login on `/me` gets the shop-rate/base-labor setup walkthrough (and its finish step pushes `/sales`, a route members can't access). Fix: return `null` for member-role users (read role from `useAuth`, same source RoleGate uses) — members should never see org onboarding. Also stamp/skip so it never fires for them later (either stamp `onboarded_at` for member users on first `/me` load, or just keep the role check — role check alone is fine and simpler).
2. **PWA `start_url` flash (minor):** `app/manifest.ts` has `start_url: '/dashboard'`, so a worker's home-screen icon opens the dashboard for a beat before RoleGate bounces to `/me`. Cheap fix: point `start_url` at a tiny neutral route (or `/login`) that forwards by role, or leave as-is if the flash is acceptable.

**Verify:** fresh member login on a phone → `/me` directly, no welcome overlay, no `/sales` push; owner login still gets onboarding when `onboarded_at` is null; home-screen icon opens into `/me` without visibly hitting the dashboard.

### Per-org vanity login URL — scoped 2026-07-17 (Cowork planning pass with Andrew)

**Goal:** each customer org gets a memorable branded sign-in address — `millsuite.com/<org-slug>` (e.g. `/built`) — for employees and for the "your own instance" feel when selling MillSuite. **Decisions locked:** vanity login page now (path style, one route — NOT a full `/built/...` route-prefix refactor); **subdomains (`built.millsuite.com`) deferred** as the later sellable-instance upgrade (added to "Next"); branding = **org name + uploadable logo**.

Key architecture fact (don't fight it): the org comes from the *login*, not the URL — the vanity page only brands the sign-in. After auth, everything stays on the normal unprefixed routes (`/me`, `/team`, …).

1. **Route `app/(marketing)/[orgSlug]/page.tsx`** — look up the org by `orgs.slug` (public read of name/logo only — mind RLS; a tiny public view or API route if needed). Unknown slug → 404 (don't leak which slugs exist beyond the page itself). Renders the branded sign-in: logo (fallback: name initial), "Sign in to {org name}", same `signInWithPassword` flow as `/login`, same post-login role routing (owner → dashboard, member → `/me` via RoleGate). Watch route collisions: the slug segment must not shadow existing marketing routes (`/login`, `/signup`, `/join`, `/pricing`, `/cancellation-policy`) — reserve those slugs at org creation too (extend the reserved list in `053_create_org_with_owner.sql`'s successor or app-side validation).
2. **Optional org mismatch guard:** if the signed-in user's org slug ≠ the page slug, show "This account belongs to a different shop" with a link to the right URL rather than silently logging into the other org (cheap confusion-saver for multi-org future).
3. **Logo upload:** `orgs.logo_url` (one migration, idempotent, run on prod first) + upload in Settings (Supabase storage bucket, public-read). Show on the vanity login + reuse later on estimate/invoice PDFs (they already want a logo — check `EstimatePdf` for an existing logo source before duplicating).
4. **Slug surfacing:** Settings shows "Your team's sign-in link: millsuite.com/{slug}" with copy button; same link shown in the /team Accounts area where Andrew creates worker logins (that's the natural "what do I tell my employee" moment).
5. `manifest.ts` `start_url` interplay: home-screen installs from the vanity page should still open into the app fine (RoleGate handles it) — just verify, no special work planned.

**Verify:** `millsuite.com/built` shows Built's name/logo sign-in; worker signs in there → `/me`; unknown slug → 404; reserved words can't become slugs; logo upload renders on the login page; normal `/login` unchanged.

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
- `[built]` Employee app → **built 2026-07-17 as "Team + shop rate + worker time app" (chunks A–D; see "Where things stand")** — worker phone app `/me`, team-page depth + accounts + per-person hours, PTO requests/approve, shop-rate extras. **Pending: run migration `062_pto.sql` on prod + live-app QA.** Learning loop (actuals → rate book) deliberately deferred. Built's benefits directory + handbook tabs also deferred (nice-to-have). PWA: manifest is already `standalone`; a worker-specific `start_url`/top-nav-hide is optional polish.
- `[unscoped]` Client portal — match Built OS _(note: portal was deleted from MillSuite early as scope creep — this is a rebuild, not a tweak)_

**Phase 3**

- `[unscoped]` Migrate data Built OS → MillSuite (plan: `../built-os/docs/DATA-MIGRATION-INVENTORY.md`), then archive Built OS
- `[unscoped]` Org subdomains (`built.millsuite.com`) — the sellable-instance upgrade over the vanity login page (scoped 2026-07-17 in "Now"): middleware resolves subdomain → org, brands login, wildcard DNS + wildcard domain on the host. Scope when a second paying customer is close.

## Open decisions _(resolve when scoping the relevant item)_

- New design format (Figma / HTML / components) — determines how Code consumes it
- Phase 2 priority order

---

## Watch out for

- Latest DB migration is `061` (057–061 = the invoicing rebuild; all run on prod). Run any new migration against prod Supabase before deploying.
- QB mode = **estimates stay in MillSuite (PDF); one project invoice pushes to QB** (estimate→QB push and per-milestone invoicing are retired). If a stray "we never send to QuickBooks" line turns up anywhere, clean it up.
- **Production is a manual step** (shipped 2026-06-23) — `sold → production` no longer auto-advances; the readiness-gated "Start production" button (project page + Ready banner) is the only path, and it's the only thing that seeds schedule allocations. Existing `production` projects unaffected. "Ready for production" is **derived**, not a stored stage. **Deposit signal** = the contract invoice's `amount_received > 0` (not a milestone flipped to "received").
- **Migration `062_pto.sql` is written but NOT yet run on prod** (chunk B). Run it against prod Supabase before/with the deploy — the /team Time-off load and the /me PTO tab are guarded so the app still renders without it, but PTO won't work until it runs. Latest migration is now `062`.
- **Per-person `hours_per_week` drives capacity + the shop rate now** (chunk A1) — `deptDailyHoursByTeam` (Σ members' hours_per_week/5) replaced headcount × dept.hours_per_day in `/capacity` + `/schedule`; `sumBillableHoursYear` replaced the uniform denominator in `computeDerivedShopRate`. 40h/wk = 8h/day so seeded 8h depts are unchanged; `dept.hours_per_day` is no longer the capacity multiplier. Inactive members drop out of both.
- **Worker logins consume a seat** (chunk A2) — creating a login on /team hits the same seat gate as /join; if at the limit it 402s. Members (role='member') are confined to `/me` by RoleGate.
- **`/capacity` and `/schedule` are now decoupled** (redesign, 2026-07-16) — editing the schedule no longer writes `project_month_allocations`; the capacity calendar is manual drag-drop only. The `source` column still exists on `project_month_allocations` (defaults `'manual'`) but nothing reads it. `lib/capacity-seed.ts` is gone.
- `../built-os` is frozen — don't build features there (but it's the **reference** for the QB port).
