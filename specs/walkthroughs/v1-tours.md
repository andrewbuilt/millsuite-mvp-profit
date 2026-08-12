# Guided walkthroughs — spec + v1 tour scripts (drafted in Cowork 2026-08-12, approved by Andrew; expanded same day)

## Structural decisions (Andrew, 2026-08-12 planning pass)

1. **Opening sequence:** existing 2-step owner wizard (shop rate + base cabinet) STAYS short →
   afterwards a dismissible **"Getting set up" checklist** on the dashboard (owner only): company
   info · logo · invoicing mode (QB vs in-house) · first team member. Each item deep-links, checks
   itself off, resumable. Welcome tour offers itself right after the wizard.
2. **Guides lives at Manage → Guides** (NOT Settings — managers must reach it). Content filtered
   by role: owners see everything; managers see everything their role can act on; workers get a
   mini guide inside /me. `data-tour` + engine + progress rules unchanged from below.
3. **Learning loop is Welcome step 6:** "You estimate hours, your team tracks actual hours, and
   the system shows the difference — every job makes the next quote smarter." (Closer moves to 7.)
4. **Practice project:** the first-job tour offers to run on a PRACTICE project — badged like
   IMPORTED, excluded from reports/capacity/outlook, one-click "Delete practice data" at tour end
   and on the Guides page. Optional — user can run the tour on a real job instead.
5. **Depth rule — core + deep-dives:** every core tour ≤ 8–10 steps, one main path only. Big
   topics get 4–6-step satellite dives launched from Guides (or a "dig deeper →" link inside a
   popover). No mega-tours.

## Full catalog (build order; scripts drafted in Cowork per phase — only v1 scripts exist below)

| Phase | Tour | Steps | Notes |
|-------|------|-------|-------|
| v1 | Welcome (+ learning loop step) | 7 | script below, add step 6 |
| v1 | Price your first job | 8 | script below; practice-project option |
| v2 | Sell it: kanban → sold → pre-pro approvals → production gates → schedule | ~10 | Andrew's "convert to project" tour |
| v2 | Capacity calendar (birdseye, drag, split months, outlook tie-in) | ~6 | small on purpose |
| v3 | Rate book basics | ~8 | + dives: materials catalog · custom products · features/calibration (4–6 each) |
| v3 | Change orders | ~7 | from the CO one-sheeter |
| v3 | Schedule (day-level) | ~6 | |
| v3 | Reports / outlook | ~5 | |
| v3 | Worker app (/me, on the phone) | 3–4 | lives inside /me, not Guides |


Implementation contract for Code: each step = { route, target: data-tour attribute, title, body,
placement }. Tag the listed elements with `data-tour="..."` — never target by class. If a step's
target doesn't exist as described, flag it back to a planning pass; don't improvise the copy.
Tone: plain shop language, second person, no jargon. Keep body text ≤ 2 sentences per step.

---

## Tour 1 — "Welcome to MillSuite" (id: welcome, ~2 min, 6 steps)

Opt-in modal: **"Get the lay of the land"** — "A two-minute walk through where everything lives.
You can quit anytime, and rerun it from Settings → Guides."

| # | Route | Target (data-tour) | Title | Body |
|---|-------|--------------------|-------|------|
| 1 | /sales | nav-sales | Sales | Every job starts here. The board tracks leads from first call to sold — drag a card between columns as the deal moves. |
| 2 | /sales | nav-projects | Projects | Sold work lives here: the project pages, the production schedule, and the capacity calendar for planning months ahead. |
| 3 | /sales | nav-manage | Manage | Your rate book, reports, team, and time tracking. The rate book is the engine — everything you price pulls from it. |
| 4 | /sales | kanban-new-project | New project | This button starts a job — name it, pick the client, and it drops onto the board. |
| 5 | /sales | nav-settings | Settings | Company info, invoicing, your logo — and the Guides menu, where you can rerun any of these walkthroughs. |
| 6 | /sales | (centered, no target) | That's the map | Ready to price your first job? |

Step 6 buttons: **"Price my first job"** (chains into tour 2) / "Done for now".

---

## Tour 2 — "Price your first job" (id: first-job, ~5 min, 8 steps)

Opt-in modal: **"Price your first job"** — "From blank board to a client-ready estimate PDF,
eight steps. Uses your real rate book — nothing here is throwaway."

| # | Route | Target (data-tour) | Title | Body |
|---|-------|--------------------|-------|------|
| 1 | /sales | kanban-new-project | Start the job | Click New project. |
| 2 | /sales (modal open) | new-project-modal | Name it | Give the job a name and pick the client — or type a new client name and it's created on the spot. |
| 3 | project page | project-home | The project home | Estimate, documents, and money all live on this page. The panel on the right totals as you build. |
| 4 | project page | add-subproject | Break it into subprojects | One per room or scope area — "Kitchen," "Bar," "Install." Each gets its own drawings and approvals later. |
| 5 | subproject page | compose-line | Compose a line | Pick what you're building — base run, uppers, one of your own products. The composer walks through materials, doors, and features, priced from your rate book. |
| 6 | subproject page | line-breakdown | Watch the price build | Labor, materials, and consumables total live as you pick. Margins apply at the project level, so subprojects stay honest costs. |
| 7 | project page | documents-estimate | Send the estimate | Email it, download the PDF, and hit Mark as sent so the estimates list tracks what's out the door. |
| 8 | /sales | kanban-board | When they say yes | Drag the card to Sold. The deposit, approvals, and production steps take over from there — that's the next guide, whenever you want it. |

---

## Settings → Guides & walkthroughs (v1 menu)

Card per tour: title, one-line description, step count, state (Not started / In progress 3 of 8 /
Completed ✓), and a Start/Resume/Restart button. Listed but marked "Coming soon" (grayed, no
button): Rate book setup · Sold to paid · Change orders · Your team + worker app.

## Engine + behavior (v1)

- driver.js (MIT, no deps), styled to DM Sans + app palette; progress "Step 3 of 8"; Back/Next;
  X or Esc dismisses (records dismissed-at-step).
- Cross-page steps navigate, then wait for the target to exist before showing the popover.
- Per-user state: `users.walkthrough_state` jsonb `{tourId: {completed_at | dismissed_at, step}}`
  (idempotent migration).
- Offer rules: `welcome` offers itself ONCE per owner/admin user on first app load after the
  owner setup wizard is done (never for members; workers get their own /me tour in a later
  version). Everything else is launched from Settings → Guides only, in v1.
- The offer modal is the opt-in: title, description, step count, Start / "Not now". "Not now"
  never re-offers automatically.
