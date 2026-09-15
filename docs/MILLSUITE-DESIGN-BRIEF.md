# MillSuite — Marketing Site Design Brief

*A product-grounded brief for an outside designer. Everything here is drawn from the actual SaaS codebase (routes, features, pricing logic, onboarding flows), not the existing marketing site. Use it to understand what MillSuite really is and does, then design freely.*

---

## 1. The one-line version

**MillSuite is profit-tracking operations software for small custom millwork and cabinet shops.** It connects estimating, scheduling, time tracking, and invoicing into one closed loop that tells a shop owner whether each job is actually making money — and gets smarter at pricing the next job every time one closes.

If you remember one sentence: *More sales won't save your shop. Knowing your numbers will.*

---

## 2. Who it's for

The buyer is a **small custom millwork / cabinet shop owner**, typically 2–50 employees. They are not beginners — they're established shops that have been running for years, have a crew, and have hit the ceiling where spreadsheets and gut feel stop working.

What defines them:

- They love their craft and the physical things they build. They got into business to make things, not to run software.
- They are selling real volume — sometimes millions of dollars of cabinetry — yet still struggle to know if any individual job made money, and sometimes struggle to pay bills.
- Their data lives in 4–5 disconnected tools: spreadsheets, QuickBooks, a separate time clock, Notion/Airtable, email. When a key employee leaves, the institutional knowledge leaves with them.
- They've tried the alternatives and been burned: enterprise ERPs (NetSuite) don't fit custom manufacturing; industry tools like Energy cost $1,400+/mo and take 7 months to implement and don't learn.

How they feel walking in: **defeated, worried, overwhelmed, burnt out.** The emotional core is the pit-in-your-stomach feeling of opening the bank account and seeing a number that doesn't match how busy the shop is.

Adjacent buyers worth designing for: stone fabricators, glass shops, and other small custom-manufacturing trades with the same bid-vs-actual problem.

---

## 3. The core problem and point of view

The shop owner's instinct, reinforced by the whole industry, is: *if money's coming in, sell more.* MillSuite's contrarian point of view is the spine of the brand:

> **"More sales at a loss kills a business twice as fast."**

The product exists to replace gut-feel with **profit clarity on every single job.** Three concrete pains it removes:

1. **"I don't know my real shop rate."** Most shops bill at a number they made up. MillSuite derives the true hourly cost from actual overhead, payroll, and billable production hours.
2. **"I don't know a job is losing money until it's already done."** MillSuite tracks live actuals (hours, material) against the bid as the job runs.
3. **"My estimates never get better."** Every completed job feeds actuals back into the rate book, so the next estimate is sharper. This learning loop is the headline differentiator — no competitor has it.

Brand belief stack the design should *feel* like: profit clarity is possible; the problem is universal not unique; the solution is proven (built in a real shop); small steps compound; built by someone who lived it.

---

## 4. The founder story (credibility anchor)

**Updated 2026-09-14, directly from Andrew, this replaces the earlier bankruptcy/26-to-15-employees version as the lead story.** That older material (still sitting in the `storytelling` skill's founder-story raw material) isn't necessarily false, but Andrew was explicit: the walkout story below is now the one to tell.

- **The inciting incident:** Andrew's #1 employee quit with two weeks' notice on January 2nd. Everything the shop needed lived in that one person's head, he could make sense of it, but there was nothing to hand the next person. No SOPs, no system, no sense of what success looked like or how to measure it, no idea whether they were even profiting, or on which jobs.
- **Andrew Watson** has run **Built LLC**, a custom millwork shop in **Tampa, FL**, for **14+ years**. Use the 14 years to mean "this problem sat unsolved for 14 years," not "MillSuite has existed for 14 years", the software itself is new; the experience behind it isn't.
- MillSuite was built to solve his own shop's problem first, and to solve it fast enough that nobody else has to lose weeks to a bad handoff the way Built LLC did.
- Rate book mechanics (what it seeds, how it self-corrects) are covered in §6, not repeated here, keep this section about the story, not the feature.

Domain expertise *is* the product. The designer should treat "this was made by a guy who has stood on a shop floor for 14 years" as a primary trust signal, not a footnote, but the specific story that earns it is the January 2nd walkout, not a vague "years of experience" claim.

**How it wins, in Andrew's own words (2026-09-14):** "We want you to have money left over after every job, and MillSuite proves it." Plus: it solves a problem that's been unsolved for 14 years, and you don't have to spend weeks learning how to use it. Lead with proof and speed, not adjectives.

---

## 5. How the product actually works — the closed loop

This is the mental model the whole product is organized around. The marketing site should communicate this loop, because it's the thing nothing else does.

```
        ┌─────────────────────────────────────────────┐
        │                                               │
   1. ESTIMATE a job  ─→  2. TRACK actual hours +      │
   (priced from your        material as the job runs    │
    rate book)                     │                     │
        ▲                          ▼                     │
        │                  3. COMPLETE the project       │
   5. Your RATE BOOK              │                      │
      gets sharper ◄── 4. Actuals feed a LEARNING LOOP   │
      (next estimate            that suggests rate updates│
       is more accurate)         │                        │
        └───────────────────────────────────────────────┘
```

Everything downstream depends on the line items being right. The line items only work because the rate book is seeded. The rate book stays honest because the learning loop feeds it. **It is one loop, not a pile of features.**

---

## 6. What parts of the business the software supports

These are the real, shipped feature areas (each is a working section of the app). Group/prioritize them however the design needs, but this is the true surface area.

**Estimating & pricing (the heart)**
- A **rate book** — the shop's living library of labor + material rates. **Verified against `lib/rate-book-seed.ts` and `app/(app)/rate-book/page.tsx` on 2026-09-14:** the rate book starts empty of dollar values. New orgs get a starter kit of category/item *shapes* (e.g. "Standard base carcass," named units, no prices) seeded in with zeroed-out numbers, "so every shop starts empty-of-numbers and fills them in as they go" (source comment, `rate-book-seed.ts`). The shop-rate and base-cabinet onboarding walkthroughs are how a shop enters its own real numbers from scratch. Every item starts at **'untested'** confidence (gray) and only gets more trusted (yellow → green) as real jobs close against it; red means drifting. There is no pre-filled pricing and no proprietary dataset behind it, the numbers are 100% the shop's own from day one. *(Open flag, not yet re-verified: this doc's "broken out per department" framing may be stale, a comment in `rate-book-seed.ts` states dollars now compute from a single blended `orgs.shop_rate`, with departments tracked in hours only, not five separate dollar rates. Confirm with Andrew before this goes further.)*
- A keyboard-first **composer** for building an estimate line by line — cabinets, doors, drawers, panels, finishes, hardware, plus fully **freeform lines** for the weird custom work (back bars, curved booths, coffered ceilings) that has no standard rate.
- **Per-project margin** with live color-coded health (green ≥32%, yellow 25–32%, red <25%).
- A **shop rate calculator** that derives true hourly cost from overhead + team comp ÷ billable hours.

**Sales & pipeline**
- A **drawing parser**: drop a PDF (architectural drawings, elevations), and AI extracts the client, the rooms/subprojects, and rough line items to seed a project. *(Top-tier feature.)*
- A **pipeline / kanban** with stages: New Lead → 50/50 → 90% → Sold → Production → Installed → Complete (and Lost).
- A lightweight **client CRM** (B2B/D2C, contacts, linked projects).

**Project management**
- A **project workspace** ("cover") that travels with the job from bidding to complete: stage strip, subproject cards, a sticky financial panel showing bid vs actual vs margin, per-department hour rollups, and an editable QuickBooks export block.
- **Pre-production / handoff approvals**: once a job is sold, material + finish decisions become approval cards (client / shop / vendor), drawings get tracked, and change orders open. The estimate locks; further edits flow through change orders.

**Scheduling & capacity**
- A **department schedule** (Gantt-style drag-drop of subproject × department across weeks), with an AI assistant for resolving conflicts.
- A **12-month capacity calendar** — drag projects into months, see per-department utilization, with PTO + holiday overrides. Auto-seeds from the schedule when a job goes to production.

**Time tracking**
- Native **timer + manual entry** on project / subproject / department, including a stripped-down **mobile view** for the crew ("select project, start/stop, done"). This is deliberately frictionless because "shop guys won't track time" is the #1 objection.

**Money in**
- **Invoices** with PDF generation, payments, A/R aging, and milestone-based cash-flow tracking.
- **QuickBooks reconciliation**: MillSuite *watches* QB for deposits/payments to advance project state — it does **not** push data into QB. (Important nuance: QB is watched, not replaced or auto-synced.)

**Intelligence**
- A **reports** dashboard: shop letter-grade (A–F), KPIs (crew size, overhead, margin vs target, utilization), completed-project diagnostics, and an 8-month revenue/staffing outlook.
- A **suggestions feed** — the learning loop surfaced: "this item runs 12% over, sharpen it." Nothing changes unless the owner accepts.

---

## 7. The steps a user takes (journey)

**Acquisition → activation**
1. Lands on the marketing site (often via the free **shop rate calculator** at tools.millsuite.com — a low-friction hook).
2. Picks a plan on **/pricing**, signs up (shop name, email, password, seat count).
3. Starter tier → 30-day free trial, no card. Pro / Pro+ → Stripe checkout.

**First-run onboarding** (a non-dismissible welcome overlay; ~5 minutes)
4. Welcome screen: *"You already know your craft."*
5. **Shop-rate walkthrough** (4 screens): overhead → team & comp → billable hours → derived rate.
6. **Base-cabinet walkthrough** (9 operations across an 8-ft run): calibrates real per-linear-foot labor.
7. Dropped into **/sales** (or /projects on Starter) — ready to price a real job immediately.

**Daily / ongoing loop**
8. New job comes in → drop the drawing or start a project → build the estimate in the composer → check margin.
9. Mark it sold → handoff → pre-production approvals → schedule it → crew tracks time.
10. Invoice against milestones; watch payments land.
11. Job completes → actuals roll up → suggestions sharpen the rate book → next bid is better.

The emotional arc the site should sell: **from dread to clarity.**

---

## 8. Plans & pricing

**Provisional, do not publish specific figures.** Andrew is reworking the pricing structure as of 2026-09-14. The table below reflects the feature-flags at time of writing but the tiers, prices, and seat minimums are expected to change. Marketing copy should say "pricing coming soon" / link out without stating dollar amounts until this is finalized. Three per-seat tiers (source of truth is the product's feature-flags, not older docs). Internal plan keys in parentheses.

| Tier | Price | Min seats | Promise | Headline unlocks |
|---|---|---|---|---|
| **Profit** (`starter`) | **$49 / seat / mo** | 1 | "Track every job, know your margin" | Dashboard, projects, time tracking, team, shop-rate calculator, invoices + payments, 1 AI report/mo. **30-day free trial, no card.** |
| **Pro** (`pro`) | **$99 / seat / mo** | 3 | "Run the whole shop with AI in your corner" | Everything in Profit + sales pipeline/kanban, rate book, **AI learning loop**, pre-production approvals, capacity calendar, QuickBooks, 2 AI reports/mo. **Most popular.** |
| **Pro+** (`pro-ai`) | **$119 / seat / mo** | 5 | "Drop drawings, schedule departments, let AI do the heavy lifting" | Everything in Pro + **drawing parser / AI estimating**, department scheduling + AI assistant, margin diagnostics, 4 AI reports/mo, priority support. |

Pricing page tone today: *"One system. Per seat. No surprises."* Month-to-month, cancel anytime, no contracts.

---

## 9. Objections the site must defuse

These come from real sales calls — the site copy and FAQ should answer them head-on:

- **"What if you disappear?"** → early adopters get their own instance, data export guarantee, open architecture.
- **"My shop is unique."** → "We've talked to shops from $1M to $50M. Same core problem."
- **"My guys won't track time."** → native mobile timer, as easy as clocking in.
- **"If the data isn't perfect, why bother?"** → perfect isn't the goal; directional data that improves every job is.
- **"We're mid-implementation on another tool."** → no hard push: "when you're ready for something that actually learns, we're here."
- **"I just need more sales."** → the core POV: more sales at a loss kills you faster.

---

## 10. Competitive framing

- **Energy** — $1,400+/mo, 7-month implementation, fixed times that never learn. MillSuite is cheaper, learns, looks better.
- **NetSuite / enterprise ERPs** — don't fit custom manufacturing, no native time tracking, clunky.
- **Spreadsheets / Airtable / generic PM tools** — siloed, no learning loop, no shop-specific features.
- **The real competitor is doing nothing** — most shops have accepted they can't know their numbers. The site's job is to make that resignation feel like a choice, not a fact.

---

## 11. Voice & tone

- **Plainspoken, shop-floor direct.** Talk like a shop owner, not a SaaS marketer. Short, concrete, confident.
- **Empathetic about the dread, optimistic about the fix.** Name the pit-in-your-stomach feeling, then offer clarity.
- **Anti-hype about software.** This audience distrusts slick tools that don't work. Bust the myth that "software has to be ugly and complicated to work for manufacturing" — but earn it by looking credible, not flashy.
- **Proof over adjectives.** "Built by a 14-year shop owner," "no card, 30-day trial," "self-corrects with every closed job" beat "powerful" and "seamless." Do not cite a training dataset size or an accuracy percentage — the product doesn't work that way (see §4).

Avoid: enterprise jargon, generic startup language, anything that sounds like it was written by someone who's never been in a dusty shop.

---

## 12. Visual & UI reference from the product

So the marketing site feels continuous with the app:

- **The app is light mode.** White panels, soft gray borders (`#E5E7EB`), near-black text (`#111`), blue accent (`#2563EB`). Clean, dense, utilitarian-but-modern — it intentionally does *not* look like clunky manufacturing software.
- **The marketing site currently** uses a warm tan/terracotta accent (`#D4956A`) against the same clean base — a "crafted, woodshop-warm" signal. The designer can keep, refine, or evolve this, but the warmth-meets-precision tension (handmade craft × financial rigor) is the brand's visual thesis.
- **Data is the hero.** The product preview that resonates is a real dashboard: Shop Rate $87.50/hr, In Production 6 projects / $284,200, Margin +32.4%, "All projects on track." Real numbers sell better than abstract illustration.
- Margin/health color language is already meaningful in-product (green good, yellow warn, red bad) — reuse it.

---

## 13. Suggested marketing-site structure

A starting skeleton (not prescriptive):

1. **Hero** — the POV hook ("More sales won't save your shop. Knowing your numbers will.") + dashboard preview + dual CTA (See pricing / free shop-rate calculator).
2. **The problem** — the three pains (don't know your rate / don't know you're losing until it's done / estimates never improve).
3. **The loop** — visualize estimate → track → complete → learn → sharper. The single most important concept.
4. **Built by a shop owner** — Andrew, Built LLC, 14 years, real project data.
5. **Feature tour** — grouped by the business areas in §6, ideally mapped to the loop rather than listed flat.
6. **Proof / by the numbers** — years, project volume, accuracy, "1 system replaces 5."
7. **Pricing** — three tiers, free trial emphasis on Profit, "Most popular" on Pro.
8. **Objection-busting FAQ** — §9.
9. **Closing CTA** — emotional: "Your next job is already in progress. Do you know if it's making money?"

---

## 14. Quick vocabulary reference (use the real words)

Shop rate · rate book · confidence badge · composer · estimate line · freeform line · subproject · margin · bid vs actual · the loop / learning loop · suggestions · pipeline stages (New Lead, 50/50, 90%, Sold, Production, Installed, Complete) · handoff · pre-production approvals · finish specs · change order · schedule / capacity · department (Engineering, CNC, Assembly, Finish, Install) · milestones · QuickBooks reconciliation (watched, not pushed) · drawing parser · shop grade.

---

*Resolved 2026-09-14: the founder-story training-dataset numbers ($10M+ vs $1.9M, and the 97–99% accuracy claim) were confirmed false by Andrew and removed from this brief, the design codex, and the messaging-framework/content-strategy/storytelling brand-plugin skills. Do not reintroduce a dataset size or accuracy percentage claim. Also flagged: pricing (§8) is provisional and being reworked; don't treat it as final.*
