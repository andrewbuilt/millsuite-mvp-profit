# BACKLOG.md

The running list of everything still to do on MillSuite. This is the **source of truth for planned work** — when you pick something up, move it; when you finish, delete it from here and record it in `CURRENT-STATE.md`. Keep it groomed: stale backlog is worse than no backlog.

**Conventions**
- `[ ]` not started · `[~]` in progress · `[x]` done (delete on next groom)
- Priority tags: **P0** (now) · **P1** (next) · **P2** (soon) · **P3** (someday)
- Each item: a one-line outcome + the file(s) or area it touches, where known.

_Last groomed: 2026-06-17_

---

## EPIC: Built OS → MillSuite data migration  ·  P0

The current real project data lives in Built OS. Goal: move it into MillSuite cleanly, verify it, then archive Built OS. Full entity inventory + mapping lives in `../built-os/docs/DATA-MIGRATION-INVENTORY.md`.

- [ ] **P0 — Pull the live Built OS schema.** Built OS has no migration files in-repo (schema is managed in the Supabase dashboard). Export the actual table list + columns from the Built OS Supabase project so we're mapping against reality, not memory.
- [ ] **P0 — Confirm source vs. target Supabase projects.** Are Built OS and MillSuite the same Supabase project or two? This determines whether the transfer is cross-project (export/import) or same-project (SQL copy). Decide before writing any migration script.
- [ ] **P0 — Map entities Built OS → MillSuite.** Leads/projects, subprojects, milestones, clients, team members, vendors/materials, time entries, QuickBooks links. Note the pricing-model translation (see below). Fill in the inventory doc.
- [ ] **P0 — Pricing-model translation.** Built OS estimates are stored as `spec_lines_json` (its v4) on subproject rows. MillSuite stores estimates as `estimate_lines` rows with `product_slots` jsonb. Decide: translate old estimates into `estimate_lines`, or import them as locked/read-only historical snapshots. (Recommendation: snapshot historical/closed jobs; only re-model active jobs.)
- [ ] **P0 — Write the transfer as an idempotent, re-runnable script** (per STANDARDS migration rules). Dry-run against a copy first.
- [ ] **P0 — Verify the transfer.** Row counts per entity, spot-check N projects end-to-end (totals, hours, milestones, client info), confirm nothing references a dead Built OS id.
- [ ] **P1 — Cut over.** Point any remaining workflow at MillSuite; freeze writes to Built OS (already frozen for code — confirm data writes too).
- [ ] **P1 — Archive Built OS.** After verification: tag the final state, mark the repo archived, stop the Vercel deploy if it's no longer needed.

---

## MillSuite build-out  ·  P1–P2

Gaps and improvements on the live product. Pulled forward from the old CURRENT-STATE "what's next" plus known debt.

### Pipeline / capacity
- [ ] **P1 — Hire/fire signal on the capacity page header** (e.g. "Need +1.2 headcount in Aug"). Based on sold + production work only. Reuses `lib/reports/outlookCalculations.ts`.
- [ ] **P2 — Auto-place pipeline projects from `target_production_month`** — requires first adding a UI to set that field (currently unused on `projects`).
- [ ] **P2 — Pipeline overlay v2 (probability-weighted), done right.** Prior attempt (PR #109) was closed: per-card weighting didn't model reality (a 50/50 either closes 100% or 0%). Revive only with better math.

### Estimating / rate book
- [ ] **P2 — LED walkthrough** (calibration flow, matching the others).
- [ ] **P2 — Drawing parser improvements** (accuracy on candidate-entity extraction).
- [ ] **P2 — Staleness banner copy:** distinguish "needs initial slots" from "rates moved."

### Invoices / billing
- [ ] **P2 — Invoice email integration** (send the react-pdf invoice).
- [ ] **P2 — Overdue invoice reminders + auto status flip.**
- [ ] **P3 — Port API routes from `shop_rate_settings` → `orgs.overhead_inputs` jsonb.**

### Dashboard / polish
- [ ] **P2 — Improve project list / dashboard view.**
- [ ] **P3 — "i" info tooltips throughout the site.**
- [ ] **P3 — Welcome sequence copy + UX polish.**
- [ ] **P3 — Demo / seeded report data cleanup** (and audit `seed-demo*.sql` against current schema — flagged L6).

---

## Tech debt / cleanup  ·  P2–P3

- [ ] **P1 — Confirm `fix/trial-plan-status-constraint` is merged to `main`** (or finish/abandon it).
- [ ] **P3 — Clean up the stray `www.millsuite.com` A record** (`66.33.60.66`) next time in DNS.

---

## Beta-tester feedback  ·  triage as it arrives

Capture each report here as a line, tag it bug/feature/usability, then promote to P0/P1 if it blocks. Don't let feedback live only in chat history.

- _(none open — add as they come in)_

---

## Done recently (clear on next groom)

See `CURRENT-STATE.md` → "Shipped" for the authoritative record. This section is just a short-term holding pen so we don't re-add something we just finished.
