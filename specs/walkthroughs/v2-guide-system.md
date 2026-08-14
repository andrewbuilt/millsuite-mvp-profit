# Guide system v2 — one system, not a pile of tours

Drafted in Cowork 2026-08-14 with Andrew. Supersedes the SCRIPTS in `v1-tours.md`.
Everything structural from v1 that survives is restated here so this file stands alone;
the Path/Shelf model, the practice-project machinery, and the fact-based gates in
`/api/guides/path` are KEPT unchanged.

---

## 1. Diagnosis — why the guides feel "between a look around and a learning system"

That phrasing (Andrew's) is exactly right, and it's structural, not a copy problem.
The engine has two step modes — INFO (Back/Next) and ACTION (no buttons, advance when
the next step's target appears) — but the scripts mix them incoherently, and ACTION's
only advance signal fires too early to teach anything.

| # | Failure | Root cause | Where |
|---|---------|-----------|-------|
| A | A card with Back/Next AND a ring around a live primary button. Two affordances, two meanings. | Rate-book step 6 ("Calibrate it") is an INFO step whose target is `add-door-type` — an action button. INFO steps must never point at a control the user is meant to press. | `lib/walkthroughs.ts:220-226` |
| B | Step 4 "jumps to Where it shows up instead of the name and price." | Step 3 is an ACTION step advancing when `material-show-in` appears — which is **the instant the add form opens**, before anything is typed. "Target appears" is the only advance signal the engine has; there is no "the thing was actually saved." | `lib/walkthroughs.ts:196-204`, `components/walkthroughs/TourRunner.tsx:417-430` |
| C | The material flow never resolves; the guide moves to Doors with the form unsaved. | No step requires **Add material** to be pressed. Worse: clicking the Doors tab (step 5's instruction) discards the unsaved form silently. The whole lesson can "complete" with zero materials and zero door types created. | `lib/walkthroughs.ts:205-219` |
| D | Step 6 does nothing; Next skips Doors entirely. | Same as A — it's an INFO step, so Next is its only path forward. Note: adding `advanceWhenNextAppears` would NOT fix it. The next step's target is `cabinets-tab`, which is **always in the DOM** (the tab bar), so it would auto-advance instantly. The real gap: no hook on the door form, no step for filling it, no save signal. | `lib/walkthroughs.ts:220-233` |
| E | The outro lies. "Your rate book is live" fires on tour attendance while `/api/guides/path` — correctly fact-based — still reads the step incomplete. | Outro fires on `reason === 'completed'` with no gate check. | `components/walkthroughs/TourProvider.tsx:280-289` |
| F | Copy drift. "Four quick questions" describes a wizard that doesn't exist — the real form is name + 4 hour fields + hardware $. "Select the button to continue" sits under bodies that never mention a button. | Copy written before the UI settled; never reconciled. | `lib/walkthroughs.ts:224`, `components/rate-book/DoorCatalog.tsx:326-363` |
| G | The learning loop — the product's core idea — is one centered text card. | v1 structural decision #3. Andrew wants it as the animated opening moment. | `lib/walkthroughs.ts:146-150` |

First-job has the same class-C bug: step 6 (`line-breakdown`, INFO) lets Next navigate
away from the composer **before the line is added**, so the lesson's own fact
(`estimate line exists`) can be false at the finish.

The fix is not better phrasing on the current steps. It's deciding what each guide IS,
and giving the engine one missing primitive.

---

## 2. The system

Four layers. Each does one job.

**Layer 1 — The welcome moment.** An animated, skippable ~14s sequence right after the
setup wizard: the five beats of the loop appear one by one, then join into a ring.
It replaces the welcome tour's offer modal — its final frame IS the offer ("Show me
around" / "I'll explore"). Rerunnable from Guides as "How MillSuite works."
Full design in §5; working mockup in `mockups/welcome-loop.html`.

**Layer 2 — The Path.** Unchanged. Ordered, gated by real app state, completion is a
fact never attendance (`/api/guides/path`). This was already right.

**Layer 3 — Guides, in two honest kinds.**

- **TOUR** — a look around. All LOOK steps, Back/Next, nothing to do. Welcome is a tour.
- **LESSON** — you build something real, and the lesson is not done until it exists.
  Rate-book and first-job are lessons. A lesson's finish line is the same fact as its
  Path gate.

The kind is declared on the guide and shown in the offer, so expectations are set:
a tour says "2 min, nothing to do"; a lesson says "4 min — you'll add 1 material and
1 door style."

**Layer 4 — Success moments.** Fire only when the facts are true (§4.3).

---

## 3. Step grammar — the iron rules

Two step types. Every step is exactly one of them, and the type is visible in the
script, not inferred.

**LOOK** — Back/Next. Points at a landmark or is centered.
**DO** — no Next button. Exactly one action. Advances only on the real result, via one of:

| Advance signal | Mechanism | Use for |
|---|---|---|
| `appears:<target>` | existing `advanceWhenNextAppears` | opens/reveals — a tab switch, a form opening |
| `event:<name>` | **new** `advanceOnEvent` (§4.1) | saves/creates — the form was actually submitted successfully |
| `project-created` | existing `waitForNewProject` | the one special case |

The rules:

1. **One action per DO step**, and the body names the exact control: "Click the
   Materials tab," "Click Add material." If the copy says click, it's a DO step.
2. **A DO step completes on the result, never the click.** A form is one DO step
   ringing the whole form, advancing on the save event — not on the form appearing.
   (Kills failures B and C.)
3. **A LOOK step never targets an interactive control its copy tells the user to
   press.** (Kills failures A and D.)
4. **`appears:` may never wait on an always-present element** (nav links, tab bars).
   It would fire instantly. Linted in `check-tour-targets.mjs` (§8).
5. **A lesson ends with its facts true.** The outro checks the Path gate before
   celebrating (§4.3).
6. **Skipping a DO step marks the lesson partial.** The stuck-affordance "Skip →"
   stays (never trap), but a skipped save means the partial outro, not the celebration.
7. **Copy budget:** DO = one imperative sentence naming the control + at most one
   sentence of why. LOOK = ≤ 2 sentences. (Matches v1's rule; now enforced per type.)
8. **Every step declares `route`.** (Already the rule; restated because resume depends
   on it.)

---

## 4. Engine changes — deliberately small

### 4.1 `advanceOnEvent`

New optional field on `TourStep`:

```ts
/** Advance when this app event fires — the real save, not the click. */
advanceOnEvent?: TourEvent
```

New module `lib/tour-events.ts`:

```ts
export type TourEvent =
  | 'ms:material-created'
  | 'ms:door-type-created'
  | 'ms:estimate-line-created'

export function announce(name: TourEvent) {
  window.dispatchEvent(new CustomEvent(name))
}
```

Fired after the successful `await`, never before:

- `announce('ms:material-created')` in `MaterialsCatalog.saveAdd` after
  `createMaterial` resolves (`components/rate-book/MaterialsCatalog.tsx:161-171`)
- `announce('ms:door-type-created')` in `DoorCatalog.saveType`, create branch only
  (`existingId === null`) (`components/rate-book/DoorCatalog.tsx:63-82`)
- `announce('ms:estimate-line-created')` where the composer's add-line save resolves

Runner: while an `advanceOnEvent` step is `ready`, listen on `window`; advance on
fire; clean up on step change. Counts as an action step (`isAction`), so the card
shows no buttons — same as today's action steps.

### 4.2 New `data-tour` hooks

| Hook | Element |
|---|---|
| `material-form` | the New-material add-form container (the whole blue box, not just Shows-in) |
| `materials-table` | the materials table container |
| `door-form` | the New-door-type add-form container |
| `cabinet-labor` | the LABOR block on the Cabinets view's item detail |
| `composer-add-line` | the composer's Add line / save button |

Existing hooks unchanged. `material-show-in` becomes unused by scripts (leave the
prop mechanism; cheap, and a deep-dive may want it).

### 4.3 Honest outros

`Tour` gains an optional `outroPartial: { title; body }`. On lesson completion,
`TourProvider` fetches `/api/guides/path` once; if the lesson's gate is false —
skipped DO steps, or bailed early — show `outroPartial` instead of `outro`.
Tours (welcome) skip the check; nothing to verify.

### 4.4 Action-step chrome line

Keep the pulsing dot, reword to point outward: **"The highlighted button is the next
step."** With rule 1 (the body names the control) it now reads as confirmation, not
contradiction.

---

## 5. The welcome moment

**When:** immediately after the setup wizard, in place of the current auto-offer modal
(`TourProvider.tsx:163-173` — same trigger, same `offered_at` stamping, different
component). Skippable at any instant. Rerunnable from Guides as **"How MillSuite
works."** `prefers-reduced-motion`: skip straight to the assembled ring.

**The five beats** (Andrew's loop, 2026-08-14):

| # | Title | Line |
|---|---|---|
| 1 | Build your rates | Your shop rate and your labor numbers. Set once. |
| 2 | Estimate the job | Every line prices straight off your rate book. |
| 3 | Track it live | Time and materials land on the job as it's built — the P&L is real while it's happening. |
| 4 | Review and tighten | Estimated against actual. Fix the numbers that were off. |
| 5 | Price the next one smarter | Your rates evolve. The loop runs again. |

**Sequence:** "Welcome to MillSuite" → beats appear one by one (~1.1s cadence, icon +
title + line) → cards glide into a ring, connectors draw, a pulse circulates →
tagline **"Every job makes the next quote smarter."** → buttons: **Show me around**
(starts the welcome tour) / **I'll explore on my own**.

Mockup with final timing, easing, and copy: `mockups/welcome-loop.html`.

**Consequence for the welcome tour:** the centered learning-loop step is now
redundant — cut it. Welcome becomes 6 steps (below).

---

## 6. Scripts (v2 — these replace v1's verbatim)

Notation: **type · target · advance**. All rate-book steps route `/rate-book`;
welcome routes `/sales/kanban`; first-job routes as v1 (ctx-based).

### 6.1 Welcome (TOUR, 6 steps, ~2 min)

Offer is the welcome moment's final frame (§5). Chain unchanged
(`Set up my rate book` / `Done for now`).

| # | Type · target · advance | Title | Body |
|---|---|---|---|
| 1 | LOOK · nav-sales · Next | Sales | Every job starts here. The board tracks leads from first call to sold — drag a card between columns as the deal moves. |
| 2 | LOOK · nav-projects · Next | Projects | Sold work lives here: the project pages, the production schedule, and the capacity calendar for planning months ahead. |
| 3 | LOOK · nav-manage · Next | Manage | Your rate book, reports, team, and time tracking. The rate book is the engine — everything you price pulls from it. |
| 4 | LOOK · kanban-new-project · Next | New project | This button starts a job. Name it, pick the client, and it drops onto the board. |
| 5 | LOOK · nav-settings · Next (skipIfMissing) | Settings | Company info, invoicing, your logo, and the Guides menu where you can rerun any of these walkthroughs. |
| 6 | LOOK · centered · chain | That's the map | Ready to set up the numbers everything prices from? |

(Step 6 body updated: it chains to the rate book now, not first-job — v1's copy read
ahead of its own button.)

### 6.2 Set up your rate book (LESSON, 11 steps, ~4 min)

Offer: **"Set up your rate book"** — "You'll add one material and one door style —
for real, in your own catalog. After this you can price an actual job. About four
minutes."

| # | Type · target · advance | Title | Body |
|---|---|---|---|
| 1 | LOOK · rate-book-tabs · Next | Your pricing engine | Everything you quote prices from here. Set it up once, tighten it as real jobs teach you. |
| 2 | DO · materials-tab · appears:add-material | Open Materials | Click the Materials tab. One list, one price per material — update a price here and every product using it reprices. |
| 3 | DO · add-material · appears:material-form | Add your first material | Click + New material. Pick a sheet good you actually buy. |
| 4 | DO · material-form · event:ms:material-created | Name it, price it, save it | Type the name and what you pay per sheet, and tick Carcass so it offers itself when you're pricing boxes. Then click Add material. |
| 5 | LOOK · materials-table · Next | That's a live price | Every estimate line that uses this material prices from this row. Change the number and every quote after it follows. |
| 6 | DO · doors-tab · appears:add-door-type | Open Doors | Click the Doors tab. Labor lives on the style — the material price stays in the catalog. |
| 7 | DO · add-door-type · appears:door-form | The style you build most | Click + New door type. |
| 8 | DO · door-form · event:ms:door-type-created | Enter your hours | Name it, put in your hours per door for each department and hardware $, then click Add door type. Hours are what make the style calibrated — it prices itself from here on. |
| 9 | DO · cabinets-tab · appears:cabinet-labor | Open Cabinets | Click the Cabinets tab. |
| 10 | LOOK · cabinet-labor · Next | Your cabinet labor | These base-cabinet hours came from your setup answers. Tighten them as tracked jobs show you the truth. |
| 11 | LOOK · centered · chain | You can price now | One material and one door style is enough for a real quote. |

Chain: **Price my first job** / Done for now.

Outro (gate `rate_book` true): **"Your rate book is live"** — "Every quote you build
from here prices off these numbers. Add more materials and styles as you go — the
composer can add them mid-job too."

Outro partial: **"Saved for where you got to"** — "Your rate book isn't finished yet —
it still needs a carcass material and a calibrated door style. Pick it up anytime
from Manage → Guides."

What this fixes, step by step: the form is one DO step that includes name and price
(B), nothing advances until Add material actually succeeds (C), the door form has
hooks and a save step of its own (D), step 9 waits on a target that only exists on
the Cabinets view (rule 4), and the celebration can't fire on an empty catalog (E).
"Four quick questions" is gone; step 8 describes the form that exists (F).

### 6.3 Price your first job (LESSON, 9 steps, ~5 min)

Offer and practice-project machinery unchanged. One structural fix: the line must be
SAVED before the tour leaves the composer.

| # | Type · target · advance | Title | Body |
|---|---|---|---|
| 1 | DO · kanban-new-project · appears:new-project-modal | Start the job | Click New project. |
| 2 | DO · new-project-modal · project-created | Name it | Give the job a name and pick the client, or type a new client name and it's created on the spot. |
| 3 | LOOK · project-home · Next | The project home | Estimate, documents, and money all live on this page. The panel on the right totals as you build. |
| 4 | DO · add-subproject · appears:compose-line | Break it into subprojects | Click Add subproject — one per room or scope area: "Kitchen," "Bar," "Install." |
| 5 | DO · compose-line · appears:line-breakdown | Compose a line | Click Compose line and pick what you're building. The composer walks through materials, doors, and features, priced from your rate book. |
| 6 | LOOK · line-breakdown · Next | Watch the price build | Labor, materials, and consumables total live as you pick. Margins apply at the project level, so subprojects stay honest costs. |
| 7 | DO · composer-add-line · event:ms:estimate-line-created | Add the line | Click Add line. It lands on the subproject with its full breakdown saved. |
| 8 | LOOK · documents-estimate · Next | Send the estimate | Email it, download the PDF, and hit Mark as sent so the estimates list tracks what's out the door. |
| 9 | LOOK · tour-project-card · Done | When they say yes | Drag the card to Sold. The deposit, approvals, and production steps take over from there — that's the next guide, whenever you want it. |

Outro (gate `first_job` true): unchanged ("That's the whole loop").
Outro partial: **"Almost priced"** — "The job's set up but no line is saved yet.
Open the subproject and compose one — or resume this guide from Manage → Guides."

---

## 7. Copy rules

Second person, plain shop language. Titles: LOOK names the idea ("Your pricing
engine"); DO names the action ("Open Materials"). DO bodies open with the verb and
the control's real label. Describe the UI that exists — if the copy and the screen
disagree, the copy loses and comes back to a planning pass (the v1 rule; failure F
is what happens without it). Never celebrate a state that isn't true. No exclamation
points; confidence, not cheerleading.

---

## 8. Verification

**Extend `scripts/check-tour-targets.mjs`** (already run after any `data-tour` change):

1. Existing checks: every scripted target resolves to exactly one tag; no duplicates.
2. NEW: an `appears:` advance whose awaited target is in `ALWAYS_PRESENT`
   (`nav-*`, `*-tab`, `rate-book-tabs`, `kanban-board`, `kanban-new-project`) fails
   the build. This is failure D's class, caught mechanically.
3. NEW: every `advanceOnEvent` name must exist in `lib/tour-events.ts`.
4. NEW: a LOOK step (no advance flag) whose target is in a declared
   `ACTION_CONTROLS` list (`add-material`, `add-door-type`, `compose-line`,
   `composer-add-line`) fails — LOOK steps don't point at buttons (rule 3).
   `kanban-new-project` is deliberately not on the list: welcome step 4 points at
   it descriptively ("This button starts a job") without instructing a press,
   which rule 3 permits.

**Manual QA script per lesson** — run before shipping any script change; each row is
"do the thing on the card, nothing else":

- Rate-book: follow steps 1→11 exactly. At every DO step, confirm the card has no
  Next. Confirm step 4 does NOT advance until Add material succeeds (try clicking
  Add with an empty name — must not advance). After step 8, confirm the door row
  shows no Uncalibrated badge. Finish; confirm full outro. Re-run with a Skip on
  step 4; confirm partial outro. Confirm Guides path card matches in both cases.
- First-job: same discipline; at step 7 confirm cancel/close does not advance.
- Resume: hard-reload mid-lesson at a DO step; confirm the stuck affordance appears
  immediately (existing behavior) and Skip marks partial.

---

## 9. Build order — each PR shippable alone

1. **Engine:** `advanceOnEvent` + `lib/tour-events.ts` + partial-outro support +
   chrome-line reword. No script changes yet; nothing user-visible.
2. **Hooks + events:** five new `data-tour` hooks, three `announce()` calls,
   `check-tour-targets.mjs` new rules. Still no user-visible change.
3. **Rate-book v2 script** (§6.2) + both outros. The headline fix.
4. **First-job v2 script** (§6.3).
5. **Welcome moment:** loop animation component (from `mockups/welcome-loop.html`),
   auto-offer swap in `TourProvider`, welcome tour trimmed to 6 steps, Guides entry
   "How MillSuite works."

Shelf deep-dives (v1 list) stay placeholders; when drafted, they follow this grammar.
