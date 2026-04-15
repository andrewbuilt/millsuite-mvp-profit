# MillSuite MVP Reporting — Status Report

**Date:** April 9, 2026  
**Context:** Demo prep — what we fixed, what's still broken, what to skip

---

## What We Fixed Today

### 1. Waterfall "pp" notation → "%"
**File:** `app/(app)/reports/diagnostics/page.tsx` line 335  
The delta bars in the waterfall chart showed values like "+3.8pp" (percentage points). Changed to "+3.8%" so it reads like normal English.

### 2. Tab navigation on all report pages
**Files:** New `components/report-tabs.tsx`, updated `diagnostics/page.tsx`, `trajectory/page.tsx`, `page.tsx`  
Diagnostics and Trajectory pages were missing the Outcomes / Diagnostics / Trajectory tab buttons. Created a shared `ReportTabs` component that highlights the active tab based on the current URL. All three pages now have consistent navigation.

### 3. Shop Grade labels
**File:** `app/(app)/reports/page.tsx`  
Renamed "Project Execution" → **"Estimating Accuracy"** and "Shop Efficiency" → **"Crew Utilization"**. Updated subtitle copy to match. The old labels made it confusing when one was red and the other green — now it's clear they measure different things.

### 4. Waterfall bar alignment
**File:** `lib/financial-engine.ts` line 255  
The Actual Margin bar didn't visually line up with the end of the Revenue Lost bar. Root cause: intermediate waterfall steps use `estimated_price` as denominator, but `actual_margin_pct` uses `actual_revenue`. Fixed by making the Actual Margin bar use the waterfall running total for its visual position. The detail text still shows the true actual margin.

### 5. Unrealistic seed data (earlier session)
**File:** `docs/seed-demo-enhanced.sql`  
Original seed data showed 62% margins. Adjusted estimated prices so margins land in the 20-30% range, realistic for millwork.

### 6. Waterfall double-counting fix (earlier session)
**File:** `lib/financial-engine.ts`  
Change orders used to show as "+$4,500 Revenue" then "-$4,500 Revenue Adjustment" — cancelling each other out. Collapsed into a single "Revenue Gained" or "Revenue Lost" line showing the net difference.

---

## What's Still Broken

### CRITICAL — Will cause confusion in demo

**Gross margin calculation excludes materials**  
**File:** `app/api/weekly-snapshot/route.ts` ~line 143  
The weekly snapshot computes gross margin as `(Revenue - Labor) / Revenue`. Materials are calculated but never subtracted. This overstates margin in the snapshot data, which feeds the Shop Grade and Trajectory charts.

**Change orders hardcoded to 0**  
**File:** `app/api/project-outcome/route.ts` ~line 142  
`change_order_count` and `change_order_revenue` are always set to 0, never queried from the database. The seed data sets these values correctly, but any newly generated outcome will ignore real change orders.

**Utilization assumed hardcoded to 80%**  
**File:** `app/api/weekly-snapshot/route.ts` ~line 152  
Every org gets `utilization_assumed: 80` regardless of their actual shop rate setup. Should read from org settings or shop rate configuration.

**Shop rate fallback hardcoded to $75**  
**Files:** `weekly-snapshot/route.ts` ~line 40, `project-outcome/route.ts` ~line 101  
If no shop rate snapshot exists, the API defaults to $75/hr. Should read from org settings.

### HIGH — Conceptual problems

**Utilization metric is misleading**  
The financial engine counts all hours logged to a project as "billable" — including hours over budget. If you sell 400 hours and spend 420, those extra 20 hours count as utilized even though you didn't bill for them. This makes it possible to show "poor estimating + great utilization" which doesn't make sense in practice. Needs a rethink: true utilization should be based on hours you actually got paid for.

**Trajectory page data model doesn't match millwork**  
Weekly revenue in the trajectory chart trends smoothly upward, but millwork revenue is lumpy (big deposits, then progress payments). Events like "Bayshore kicked off +$340k" don't correlate with any visible revenue bump. The chart and the event log tell disconnected stories. The seed data for weekly snapshots needs to be realistic, or the Trajectory tab should be skipped in the demo.

### MEDIUM — Won't derail demo but should fix

**Dead code in weekly-snapshot route**  
~Line 75-76: Comment says "This won't work — need to join." Code works around it but the dead path remains.

**Material/revenue fallback in project-outcome route**  
If a project has no actual material or revenue data, the API falls back to estimated values. This means incomplete projects could show artificially perfect margins.

---

## Demo Recommendation

**Show with confidence:** Outcomes tab, Diagnostics tab  
These tell a coherent story with the current seed data. Margins are realistic, the waterfall makes sense, the takeaway text is clear.

**Skip or show briefly:** Trajectory tab  
The data doesn't match how millwork revenue actually works. If you must show it, frame it as "here's where we're headed with this feature" rather than demoing the current data.

**Don't demo:** Taking a new snapshot live  
The snapshot API has the materials bug and hardcoded values. The existing seed data is fine, but generating new data live could produce weird numbers.

---

## Files Changed

| File | Change |
|------|--------|
| `components/report-tabs.tsx` | **NEW** — shared tab navigation component |
| `app/(app)/reports/page.tsx` | Replaced inline tabs with ReportTabs, renamed Shop Grade labels |
| `app/(app)/reports/diagnostics/page.tsx` | Added ReportTabs, fixed "pp" → "%" |
| `app/(app)/reports/trajectory/page.tsx` | Added ReportTabs |
| `lib/financial-engine.ts` | Waterfall alignment fix (running total for actual margin bar) |
| `docs/seed-demo-enhanced.sql` | Realistic margins (earlier session) |
