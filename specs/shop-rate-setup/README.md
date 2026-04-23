# Shop Rate Setup — Approved Spec

> **V1 status:** This is the V1 onboarding Step 1. Per BUILD-ORDER Phase 12
> item 12, the four-screen blended-rate flow (Overhead → Team → Billable
> Hours → Result) ships inside the welcome overlay. Composer math uses
> a single `orgs.shop_rate` — per-department rates are removed. See
> `BUILD-ORDER.md` Phase 12 item 12 for the pivot context.
>
> The V1 scope is a simplified cut of the flow below:
> - No Identity screen (business name etc. captured elsewhere).
> - Team rows: name + annual comp only (no role, no billable Y/N, no
>   per-row pay-type toggle — hourly-to-annual conversion happens in
>   the walkthrough before persist).
> - Billable hours: single-crew-equivalent. `hrs/wk × wks/yr × utilization%`,
>   no headcount multiplication.
> - Result: no markup % — shop rate is cost-per-hour directly.
> - Persistence: three jsonb columns on `orgs` (migration 022), not
>   child tables.
>
> The richer version below (identity, role enum, billable flags,
> markup %, drop-in-documents path) remains approved for the
> post-onboarding recalibration surface.

**Status:** Approved for build · 2026-04-22
**Owner:** Andrew
**Related plan:** [`docs/ONBOARDING-PLAN.md`](../../docs/ONBOARDING-PLAN.md)

This folder holds the approved clickable spec for **onboarding step 1 — the shop rate calculator**.

## What to open

- **`index.html`** — the clickable wireframe. Open in a browser. Full flow: welcome → path chooser → identity → team → overhead → billable hours → shop-rate result. No backend; state is in-memory.

## What this is

The first real step of onboarding. Before the user can calibrate their build numbers (step 2 and beyond), they need a defensible shop rate. This screen flow forces that to happen.

Framing: **"What does it cost you to have your crew working for an hour, overhead included?"** — built from wages/salaries, overhead, and billable hours. Output is a single blended rate with a tunable markup.

## The flow

| # | Screen | Purpose |
|---|---|---|
| 0 | Welcome | Frames the two-phase setup (shop rate → build numbers). |
| 1 | Path chooser | Manual path (active) or drop-in-documents (Soon). |
| 1a | Parse Soon | Placeholder for doc-parsing; falls back to manual. |
| 2 | Identity | Business name, owner name, address, phone, email. |
| 3 | Team | Rows of (Name, Role, Burdened pay, Billable Y/N). |
| 4 | Overhead | 9 pre-filled monthly categories; editable; live totals. |
| 5 | Billable hours | Auto-derived from billable crew × hrs/wk × wks × utilization%. |
| 6 | Result | Shop rate hero + live markup + math breakdown. |

## Interaction rules (for the build)

- **Team → Burdened pay:** per-row toggle between `$/hr` and `$/yr`. Salary employees contribute their annual figure directly to labor cost; hourly employees contribute `$/hr × hrs/wk × wks`.
- **Team → Billable Y/N:** drives the billable-employee count used on the billable-hours screen. Non-billable (e.g., office, admin) still counts toward labor cost but not toward billable hours.
- **Overhead:** categories are editable labels with a monthly $ amount. Rows can be added/removed. Totals recompute live (monthly + annual).
- **Billable hours:** computed as `billable_employee_count × hours_per_week × working_weeks × utilization%`. All four factors are editable; the count field is read-only and derived from the team list. There is **no direct-override field** in this version.
- **Utilization % copy:** *"Actual time working on billable hours. Rework, cleaning and watercooler sessions eat into output."*
- **Result:** single blended rate. Markup defaults to 30% and is live-adjustable on the result screen. Result lede tells the user this calculation lives in the gear icon top-right and should be updated on raises, hires, fires, and new loans.

## Output contract

After step 1 the system persists the following on the org:

```ts
org.shop_info = { businessName, ownerName, address, city, state, zip, phone, email };

org.team = [{ name, role, payType: 'hourly' | 'salary', rate: number, billable: boolean }];

org.overhead = [{ label: string, monthly: number }];

org.billable_config = {
  hoursPerWeekPerPerson: number,
  workingWeeks: number,
  utilization: number,  // 0–100
};

org.markup_pct = number;  // default 30

// Derived fields, recomputed on any input change:
org.derived.annual_labor   = Σ (salary OR hourly × hrs/wk × wks) across team;
org.derived.annual_overhead = Σ monthly × 12 across overhead;
org.derived.billable_hours = billable_count × hrs/wk × wks × utilization/100;
org.derived.cost_per_hour  = (annual_labor + annual_overhead) / billable_hours;
org.derived.shop_rate      = cost_per_hour × (1 + markup_pct/100);
```

## Roles enum

`Engineering`, `CNC`, `Assembly`, `Finish`, `Install`, `Admin/Office`.

## Default overhead categories

Rent / mortgage · Utilities · Insurance (biz + WC) · Equipment payments · Debt service · Software · Marketing · Vehicles / fuel · Office / admin.

Users can rename, remove, or add categories.

## Build target

Next.js route: `app/(app)/onboarding/shop-rate/page.tsx` (or subroute per screen).
Data persistence: extend the existing `orgs` table with the fields above, plus `org_team_members` and `org_overhead_categories` child tables.
Re-entry point (post-onboarding): a gear-icon sheet accessible from the top-right of the app that opens this same form.

## Later work (deferred)

- **Drop-in-documents path.** OCR / parsing of business cards, paystubs, and bank statements. Shown as a "Soon" tile on the path chooser in V1.
- **Per-department rates.** V1 ships with a single blended rate. The base-cabinet walkthrough currently uses hardcoded per-dept labor rates; a follow-up step will derive those from the blended rate × dept multipliers or accept them as manual per-dept inputs.
