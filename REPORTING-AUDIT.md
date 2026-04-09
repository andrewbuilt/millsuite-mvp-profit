# MillSuite MVP — Reporting Feature Audit

## How It Works (Quick Version)

Reporting has **three tabs**, gated by plan tier. Data flows in from two pipelines — **weekly snapshots** (shop-wide metrics captured each week) and **project outcomes** (locked financial records created when a project is marked complete). All the math lives in a single file (`lib/financial-engine.ts`) as pure functions.

---

## Tab 1: Outcomes (Starter+)

**What it shows:** A shop-wide scorecard for completed projects.

**Key sections:**

- **Shop Grade (A–F):** A composite score out of 100 averaging two sub-scores:
  - *Project Execution* (50% estimate hit rate + 50% margin performance vs 25% target)
  - *Shop Efficiency* (how close actual utilization is to the 80% assumption — each point off = 2.5 score points)
- **Utilization Confidence Banner:** Warns when actual utilization is below the assumed 80%. Shows estimated margin overstatement (each utilization point gap ≈ 0.5 margin points overstated).
- **Summary Cards:** Total billed, total profit, average margin %, estimate hit rate %
- **Project Margins Table:** Horizontal bars per project colored green (≥25%), orange (15–25%), red (<15%) against a 25% target line.

**Period filter:** 90 days, 6 months, or 1 year (filters project outcomes by `completed_at` date).

**Data source:** `project_outcomes` table + latest `weekly_snapshots` row.

---

## Tab 2: Diagnostics (Pro+)

**What it shows:** Per-project margin gap analysis — *why* a project hit or missed its target.

**Key sections:**

- **Project Selector:** Dropdown of all completed projects (shows margin % next to name).
- **Summary Grid:** Side-by-side estimated vs actual for revenue, hours, materials, and margin. Hours and materials show variance % color-coded red (over) or green (under).
- **Waterfall Chart:** Custom SVG showing margin movement from estimate → actual:
  - Starts with "Estimated Margin" bar
  - Then shows positive/negative delta bars for: Hours Variance, Material Variance, Change Orders, Revenue Adjustment
  - Ends with "Actual Margin" total bar
  - Green = positive impact, Red = negative, Blue = totals
- **Department Breakdown Table:** Est. vs actual hours by department, with variance in hours and %. Sorted by largest variance first.
- **Key Takeaway Banner:** Auto-generated insight identifying whether the project beat or missed its target and the primary driver (e.g., "hours ran over in Fabrication by 15%").

**Data source:** `project_outcomes` table (specifically `dept_hours_estimated` and `dept_hours_actual` JSONB fields).

---

## Tab 3: Trajectory (Enterprise)

**What it shows:** Long-term shop performance trends over time.

**Key sections:**

- **Three-Line SVG Chart:** Plots shop rate ($/hr), weekly revenue ($), and gross margin (%) over up to 52 weeks. Interactive hover tooltips show exact values.
- **Shop Events Overlay:** Vertical dashed lines on the chart marking events like hires, departures, raises, equipment purchases. Color-coded by type.
- **Headcount Chart:** Small chart showing headcount over time.
- **Utilization Chart:** Small chart showing actual vs assumed utilization.
- **Event Management:** Form to add new events (date, type, title, description, financial impact, person name).

**Data source:** `weekly_snapshots` table (up to 52 rows) + `shop_events` table.

---

## Data Pipelines

### Weekly Snapshot (`POST /api/weekly-snapshot`)

Triggered by: "Take Snapshot" button on the reports page header (or scheduled job).

What it does:
1. Calculates the Monday of the current week
2. Fetches latest shop rate from `shop_rate_snapshots`
3. Counts active users (headcount)
4. Sums `time_entries` for the week → billable hours
5. Calculates utilization: (billable_hours / (headcount × 40)) × 100
6. Sums `cash_flow` payments (received/partial) for the week → revenue
7. Sums `invoices` for the week → material costs
8. Calculates weekly overhead from `shop_rate_settings` (monthly ÷ 4.33)
9. Labor cost = billable hours × shop rate
10. Gross margin % = (revenue − labor cost) / revenue × 100
11. Counts active and completed projects
12. **Upserts** on (org_id, week_start) — safe to re-run

### Project Outcome (`POST /api/project-outcome`)

Triggered by: Project status changing to 'complete'.

What it does:
1. Checks if outcome already exists (one per project — insert-once, no updates)
2. Fetches project + subprojects for estimates
3. Sums time_entries → actual hours
4. Fetches department_allocations → dept-level hours breakdown
5. Sums cash_flow → actual revenue (falls back to estimated_price if no payments)
6. Sums invoices → actual materials (falls back to estimated materials)
7. Calculates margin, variances, and locks the shop rate at completion time
8. Inserts single `project_outcomes` row

---

## Plan Gating

| Report Tab | Minimum Plan |
|-----------|-------------|
| Outcomes | Starter |
| Diagnostics | Pro |
| Trajectory | Enterprise |

Locked tabs show a lock icon in the tab bar. Clicking through shows an upgrade prompt linking to `/settings`.

---

## Computation Functions (financial-engine.ts)

| Function | What It Computes |
|----------|-----------------|
| `computeShopGrade()` | Overall A–F grade from project execution + shop efficiency scores |
| `computeUtilizationConfidence()` | Utilization gap, margin overstatement estimate, healthy/warning/critical status |
| `computeWaterfall()` | Array of waterfall items showing margin movement from estimate to actual |
| `computeOutcomeSummary()` | Totals (projects, revenue, profit), averages (margin, hit rate), best/worst project |
| `computeTrailingAvg()` | Trailing N-week moving average for any snapshot field |

---

## Potential Issues / Notes for Demo

1. **Utilization assumption is hardcoded to 80%** — see `weekly-snapshot/route.ts` line 153 (`utilization_assumed: 80`). Comment says "TODO: make configurable per org."

2. **Dead code on line 75-76 of weekly-snapshot:** Initial `cash_flow` query uses `org_id` as `project_id` (wrong), but it's immediately overridden by the correct approach on lines 78-94. No bug in behavior, but the dead query runs unnecessarily.

3. **Change orders always 0:** The project-outcome API hardcodes `change_order_count: 0` and `change_order_revenue: 0` (line 142-143). The waterfall chart *can* display change orders, but the data is never populated.

4. **Material fallback logic:** If no invoices exist for a project, the outcome uses `estimatedMaterials` as actual. This means material variance would show as 0% — could be misleading if materials just weren't tracked.

5. **Revenue fallback logic:** Similarly, if no `cash_flow` payments exist, `estimated_price` is used as `actual_revenue`. This means margin could look "perfect" for projects where payments just weren't logged.

6. **Gross margin formula excludes materials and overhead** — The weekly snapshot calculates `gross_margin_pct` as `(revenue - labor_cost) / revenue`. Materials and overhead are captured but not factored into the margin %. This is different from the project outcome margin which does subtract materials.

7. **Invoice field mismatch:** The weekly snapshot queries `invoices.total_amount` but the project outcome queries `invoices.total`. Could be different tables or a schema inconsistency worth verifying.

8. **Diagnostics loads all outcomes** (no period filter) — unlike the Outcomes tab which filters by 90d/6m/1y.

9. **Trajectory limits to 52 snapshots** — if snapshots have been taken for more than a year, older data is not visible.

10. **No error handling on snapshot button** — `takeSnapshot()` has a silent catch block. If it fails, the user gets no feedback.
