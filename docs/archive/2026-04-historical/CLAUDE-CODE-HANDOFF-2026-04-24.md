# Claude Code handoff — Phase 12 close-out

**Date:** 2026-04-24
**Scope:** Everything unchecked in `BUILD-ORDER.md` Phase 12, in the order below.
**Close-out gate:** Task 25 (dogfood one real estimate end-to-end).

---

## Read these before writing code

1. `BUILD-ORDER.md` — Phase 11 (collapsed) + Phase 12 (audit-corrected). This is the authoritative plan.
2. `SYSTEM-MAP.md` — section 1 "First-run state (welcome overlay + starter rate book)" and the resolved-with-Andrew section. Both were amended 2026-04-24.
3. `specs/add-line-composer/README.md` — **read the amendment block at the top first**. It overrides the body of the spec and the prototype HTML on four points: light-mode chrome, no sheets-per-LF ask, interior/exterior finish split, blended shop rate.

**Do NOT trust** the dark-mode styling in `specs/add-line-composer/index.html`, the "Department rates + install rate" line in the overlay spec, or the per-dept shop-rate defaults in `lib/rate-book-seed.ts`'s header. All superseded — see the amendment banner in each file.

---

## What's actually live, what isn't (audit, April 2026)

### Live and working (don't rebuild)
- Phases 0–10 shipped. Rate book, subproject editor, project rollup, sold handoff, preprod approvals, change orders, schedule, time tracking, QB watcher, suggestions/learning loop — all real.
- Phase 12 Items 1 (schema), 2 (`lib/products.ts`), 4 (`BaseCabinetWalkthrough.tsx` — 9 ops, light mode, correct palette), 5 (`WelcomeOverlay` + `useOnboardingStatus`), 9 (install prefill), 10 (line staleness via `lib/composer-staleness.ts`), and 12 (first-principles shop-rate walkthrough on `orgs.overhead_inputs`/`team_members`/`billable_hours_inputs`, writes `orgs.shop_rate`) are built and wired.
- `WelcomeOverlay` is the only place dark-mode chrome belongs.

### Open (your scope)
- **Item 6 — AddLineComposer** (`components/composer/AddLineComposer.tsx`). Still dark-mode. Still asks sheets-per-LF on carcass add. Interior + exterior finish dropdowns both read the same `rateBook.finishes` list.
- **Item 7 — DoorStyleWalkthrough** — needs light-mode reskin only (logic is fine).
- **Item 8 — FinishWalkthrough** — needs light-mode reskin + `application` (interior|exterior) field.
- **Task 15** — Shop-rate walkthrough: add `billable: boolean` per team member (only billable rows count toward `total_team_comp`); drop `Admin` from the Overhead row templates.
- **Task 16** — Drop activity picker on `/subprojects/new`.
- **Task 17** — Delete retired Phase 11 surfaces (`app/(app)/onboarding/`, orphan helpers in `lib/onboarding.ts`; keep `bumpItemConfidence` + `deriveConfidence`).
- **Task 18** — Apply migration 024 in Supabase; verify BaseCabinetWalkthrough save path no longer 403s.
- **Item 11 — Dogfood** one real estimate end-to-end, log in `docs/dogfood-<project-slug>.md`.

---

## Execution order

1. **Migration 025 — `rate_book_items.application`.** `db/migrations/025_finish_application.sql`. Add `application text NULL` with `CHECK (application IN ('interior','exterior'))`. Backfill existing `item_type='finish'` rows to `'exterior'` (that's how they were being used). Update `lib/rate-book-seed.ts` so the seeded finish rows carry `application`. No RLS change — 024 already covers the table. **Blocks Items 6 and 8.**
2. **Task 18 — Apply migration 024** (already written, sitting in `db/migrations/`). Apply via Supabase dashboard or CLI, then re-run `BaseCabinetWalkthrough` from a fresh org and confirm the save succeeds. **Blocks Item 11.**
3. **Item 7 — DoorStyleWalkthrough reskin.** Smallest, highest-leverage unblocker: establishes the light-mode palette component before the bigger reskins. No logic changes.
4. **Item 6 — AddLineComposer.** The big one. Three sub-tasks:
   - **6a. Light-mode reskin.** Swap `bg-[#0F172A]/85` backdrop → `bg-black/40` (or a white-glass alternative matching `/rate-book`'s overlays), `bg-[#0D0D0D]` → `bg-white`, `bg-[#141414]` inputs → `bg-white border-[#E5E7EB]`, `text-white` → `text-[#111]`, muted greys → `text-[#6B7280]` / `text-[#9CA3AF]`, accents → `#2563EB`. Side panel background → `#F9FAFB`. Reference `/rate-book/page.tsx` and `app/(app)/projects/[id]/subprojects/[subId]/page.tsx` for the established light palette — don't invent a new one.
   - **6b. Drop the sheets-per-LF ask.** `askSheetsPerLf` at line 615 is hardcoded `true` for carcass. Remove the input; compute from `lib/products.ts` (`sheetsPerLfFace`: Base 1/12, Upper 1/8, Full 1/4) and show as a read-only derived number. Same for face materials — never ask.
   - **6c. Separate interior/exterior finish.** Today both dropdowns source from `rateBook.finishes` (lines 711 + 727). Split:
     - Interior dropdown = `rateBook.finishes.filter(f => f.application === 'interior')`, **with a built-in `Prefinished` sentinel option at the top** (zero cost, zero labor, not a rate-book row — it's a client-side constant like `{id: '__prefinished__', label: 'Prefinished', application: 'interior'}`). `Prefinished` is the default when the chosen carcass material is pre-finished (melamine, prefinished ply) but always selectable. Field is always rendered; no conditional show/hide.
     - Exterior dropdown = `rateBook.finishes.filter(f => f.application === 'exterior')`.
     - Each dropdown's "+ Add new finish" opens `FinishWalkthrough` with `application` preset so the new row writes the right discriminator.
     - On save, if the user picked `Prefinished` for interior, the computed interior-finish labor/material are both zero — no rate-book lookup needed, no special-case compute branch elsewhere if you make `Prefinished` resolve to a zero-cost stub finish record in the breakdown math.
5. **Item 8 — FinishWalkthrough.** Light reskin + `application` field on save. Add a "Duplicate for the other application" affordance on the save confirmation — it creates a twin row with the other application value, same recipe, blank labor/material (operator calibrates it later in context).
6. **Task 16 — activity picker drop.** `app/(app)/projects/[id]/subprojects/new/page.tsx`: delete the `ACTIVITY_TYPES` constant (lines 19–26), the picker UI (lines 136–153), and the `activity_type` field on the insert (line 89). Keep everything else. Follow-up migration to drop the column after confirming no readers — `grep -rn "activity_type" --include="*.ts" --include="*.tsx" .` before dropping.
7. **Task 15 — shop-rate walkthrough billable flag + drop Admin.** In the Team screen component: add a `billable` checkbox per team row, default `true`. The shop-rate formula sums only `team_members.filter(t => t.billable).comp_annual` into `total_team_comp`. In the Overhead screen row templates, remove any `Admin` row (admin comp now goes in Team, and admin-only people stay unbilled). Migration if `team_members` jsonb rows don't already have a `billable` key — write a backfill default of `true` to preserve existing math.
8. **Task 17 — retired Phase 11 cleanup.** Delete `app/(app)/onboarding/` directory. In `lib/onboarding.ts`, delete everything EXCEPT `bumpItemConfidence` and `deriveConfidence` (both are still called from `lib/suggestions.ts` — verify with grep before deleting anything). Write a migration to drop `onboarding_progress` and `onboarding_stashed_baselines` tables. The stale-code banner at the top of `lib/onboarding.ts` already enumerates what's dead.
9. **Item 11 — dogfood.** Take one real customer project through the flow. Write `docs/dogfood-<slug>.md` with per-step notes: what worked, what broke, anything that still feels rough. This is the close-out gate — only check Item 11 off if you actually priced an estimate end-to-end, not if you just clicked through the UI.

---

## Invariants that must hold at each step

- **Dark mode only in `WelcomeOverlay`.** If you touch any other component and it reads `bg-[#0D0D0D]` / `bg-[#0F172A]` / `text-white` as chrome, that's the wrong palette. Reskin it while you're there.
- **Sheets-per-LF is never asked.** If you see an input labeled "Sheets per LF" anywhere in the composer or a material-add flow, delete it.
- **Interior ≠ Exterior finish.** Never populate both from the same list without an `application` filter. Same recipe name on both sides = two rate-book rows.
- **Per-dept dollars are dead.** Any code reading `shop_labor_rates` is suspect (table was dropped in 023). If you find a live reader, route it through `orgs.shop_rate` or flag it in a commit message.
- **`activity_type` on subprojects is a relic.** Stop writing it, stop reading it.

---

## Open design questions (for Andrew, not for you to decide)

- **Admin comp.** Task 15 drops `Admin` from Overhead templates on the assumption that admin headcount moves to Team with `billable: false`. Confirm with Andrew before deleting the row template — if he wants admin in Overhead as a pure $ category (not tied to a named person), leave the template but document the intent.
- **Duplicate-for-other-application UX.** In Item 8, the "Duplicate for the other application" button is the cleanest path, but an alternative is to not offer it at all and force operators to re-run the walkthrough per application. Default to offering it; kill if it confuses dogfood.
- **`Prefinished` as sentinel vs real rate-book row.** Current plan: client-side constant, not a rate-book row. If it ever needs to carry consumables % or a "check box for prefinished finish cost" line item, revisit. V1 = sentinel.

---

## Don't do

- Don't re-open the design questions settled in `specs/add-line-composer/README.md` rounds 2–6.
- Don't rebuild onboarding as a multi-step wizard with business-card/past-estimate/bank-statement inputs. That's retired. First-run = welcome → shop-rate (first-principles) → base-cab.
- Don't add user-configurable sheets-per-LF, door-labor multipliers, or product-specific overrides. V1 ships with the hardcoded `lib/products.ts` constants.
- Don't ship any new page in dark mode.

---

## When you're done

Update `BUILD-ORDER.md` — check off Items 6, 7, 8, 11 and Tasks 15, 16, 17, 18 with the migration / PR references in the `_italic notes_` style used everywhere else in the file. Close Phase 12 in a commit that says so explicitly.
