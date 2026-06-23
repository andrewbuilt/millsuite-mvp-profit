# STATE.md

> The one living doc. Top = where things actually stand. Bottom = what's next.
> Rewrite this at the end of every session (see ritual in `CLAUDE.md`). Keep it lean —
> delete finished items, don't archive them here.

**Last updated:** 2026-06-23 · **Branch:** `main`

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

---

## Now

_Nothing active to build._ Change Orders is **parked** (see below). The remaining Phase 1 items are all `[unscoped]`/`[ongoing]` — bring one back through a Cowork scoping pass before building.

**Just shipped (2026-06-23):** Projects dashboard + production lifecycle — see "Where things stand." Left for Andrew: **end-to-end QA on a real sold project** (Ready chip + green banner + Start → `production` + allocations seeded; dashboard buckets/metrics with live data).

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

## On deck — scoped, not started _(start after the estimates/CO item lands; both touch the project page + `nav.tsx`)_

### ~~Slide-out side nav~~ → shipped as a TOP NAV (2026-06-19)

**Shipped as a hoisted top bar, not a drawer** (Andrew preferred the top bar) — see "Where things stand" → "Top nav shipped." The drawer spec below is **superseded**, kept only for reference. Remaining cleanup (remove per-page `<Nav/>` + delete the `nav.tsx` stub) is **done (2026-06-22)** — see "Where things stand" → "Top nav shipped."

**Goal:** replace the horizontal top bar with a **left slide-out drawer** — text-only (no icons), mobile-ready. **Modal pattern:** a **solid white panel** slides in while the app behind it **frosts + dims** (backdrop blur). Defaults **closed**; a ☰ button in a slim top bar opens it; tap the dimmed backdrop or × to close. Build **style-neutral** (the aesthetic pass refines visuals).

**Confirmed structure (approved prototype):**
- Brand "MillSuite" at the top of the panel → Dashboard. No standalone Dashboard item.
- **Sales** → Kanban, Clients, Invoices
- **Projects** → Projects (new leaf → the `/projects` dashboard), Schedule, Capacity
- **Manage** (new group) → Reports, Suggestions, Rate book, Team, Time
- **Plain-text**, collapsible group headers; items text-only — no icons anywhere.
- This is only the menu's organization — **not** the `[ongoing]` department-view reorg (role/dept-scoped views), which stays separate.

**Build:**
- New `components/side-nav.tsx` (refactor of `components/nav.tsx`): off-canvas left drawer; **solid panel** (`--color-background-primary`); **frosted + dimmed backdrop** (`backdrop-filter: blur` over a translucent scrim); slide transition; default **closed** (open state in React). Same drawer on desktop + mobile (panel width ~`min(280px, 82%)`).
- **Slim top bar** in the shell holds the ☰ toggle + brand.
- **Hoist nav into `app/(app)/layout.tsx`** so it renders once (today each page renders its own `<Nav/>`); remove the per-page renders.
- **New "Projects" leaf** → `/projects` (point at the current projects list if no dedicated dashboard exists yet; upgrade later).
- **Preserve all gating:** `hasAccess(plan, feature)` per item (Reports=`outcomes`, Sales=`sales`, Schedule=`schedule`, Capacity=`capacity`, Rate book/Suggestions=`rate-book`, Team=`team`); the **Invoices** leaf also respects the **invoicing-mode gate**; a group header shows only if ≥1 child is accessible. Member role → minimal nav (Time only), as today.
- **No icons anywhere** — drop the lucide icons; if any page renders an icon beside its header title, remove those too.
- Accessibility: ☰ has an `aria-label`; `aria-expanded` on group headers; ESC + backdrop click close; focus trap while open.

**Out of scope:** department-view (role/dept) reorg; final visual styling.

**Verify:** every current route reachable from the drawer with identical gating; **Invoices** hidden when invoicing is off; member sees only Time; ☰ opens / backdrop / × / ESC close; groups collapse/expand; works at mobile width; grep that pages no longer import/render the old `Nav` (nav now lives in the layout); active-route highlight works.

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
- `[unscoped]` Capacity calendar — match Built OS + add functionality
- `[unscoped]` Employee app — match Built OS look/feel + function, then add features
- `[unscoped]` Client portal — match Built OS _(note: portal was deleted from MillSuite early as scope creep — this is a rebuild, not a tweak)_

**Phase 3**

- `[unscoped]` Migrate data Built OS → MillSuite (plan: `../built-os/docs/DATA-MIGRATION-INVENTORY.md`), then archive Built OS

## Open decisions _(resolve when scoping the relevant item)_

- New design format (Figma / HTML / components) — determines how Code consumes it
- Phase 2 priority order

---

## Watch out for

- Latest DB migration is `061` (057–061 = the invoicing rebuild; all run on prod). Run any new migration against prod Supabase before deploying.
- QB mode = **estimates stay in MillSuite (PDF); one project invoice pushes to QB** (estimate→QB push and per-milestone invoicing are retired). If a stray "we never send to QuickBooks" line turns up anywhere, clean it up.
- **Production is a manual step** (shipped 2026-06-23) — `sold → production` no longer auto-advances; the readiness-gated "Start production" button (project page + Ready banner) is the only path, and it's the only thing that seeds schedule allocations. Existing `production` projects unaffected. "Ready for production" is **derived**, not a stored stage. **Deposit signal** = the contract invoice's `amount_received > 0` (not a milestone flipped to "received").
- `../built-os` is frozen — don't build features there (but it's the **reference** for the QB port).
