// ============================================================================
// lib/walkthroughs.ts — the guided-tour catalog (v1)
// ============================================================================
// Every tour is DATA. The engine (components/walkthroughs/TourRunner) knows how
// to navigate, spotlight and persist; it knows nothing about what any tour says.
//
// The scripts below are transcribed VERBATIM from specs/walkthroughs/v1-tours.md
// (drafted in Cowork 2026-08-12, approved by Andrew). Titles and bodies are not
// ours to reword — if a step's target doesn't exist as described, that goes back
// to a planning pass rather than getting improvised here.
//
// Targets are `data-tour="..."` attributes, never classes. A class is a styling
// decision someone will change without knowing a tour is standing on it.
//
// This module is plain TS with no React imports on purpose: /api/me/progress
// validates tour ids against TOUR_IDS, so the server and the browser agree on
// what a real tour is.
// ============================================================================

import type { TourEvent } from './tour-events'

export type TourId = 'welcome' | 'rate-book' | 'first-job'

/** What the engine has learned while the tour runs. The first-job tour follows
 *  the user into a project it can't know the id of up front. */
export interface TourContext {
  /** '/projects/<id>' — captured the first time the tour sees a project page. */
  projectPath: string | null
  /** '/projects/<id>/subprojects/<id>' — same, one level down. */
  subprojectPath: string | null
}

export interface TourStep {
  /** Where the step lives. A string navigates there; a function builds the path
   *  from what the tour has learned. Returning null means "stay put".
   *
   *  Declare this on EVERY step, not just the first one on a page. Resume
   *  starts a fresh runner with no memory of where earlier steps ran, so a
   *  routeless step resumes wherever the user happened to be — which is how
   *  Resume from Guides ended up running the rate-book tour on the Guides page.
   *  Inheriting the previous step's route would be wrong: first-job's step 3
   *  happens on the project the user just created, and inheriting would drag
   *  them back to the kanban board. */
  route?: string | ((ctx: TourContext) => string | null)
  /** data-tour value to spotlight. Omitted = centered step, no spotlight. */
  target?: string
  title: string
  body: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** Set when the NEXT step's target only appears once the user acts — opens
   *  the modal, creates the project. The engine watches for it and advances the
   *  moment it shows up, so the tour follows the user through the real flow
   *  instead of asking them to press Next after every click. The Next button
   *  still works, for anyone who'd rather read than do. */
  advanceWhenNextAppears?: boolean
  /** Advance when this app event fires — the real save, not the click.
   *  This is how a form step waits for Add material to actually succeed
   *  rather than advancing the moment the form opens. Marks the step as an
   *  action step, same as advanceWhenNextAppears. See lib/tour-events. */
  advanceOnEvent?: TourEvent
  /** A missing target is expected here, so drop the step rather than falling
   *  back to a centered popover. Settings is owner-only. */
  skipIfMissing?: boolean
  /** Wait for a project that didn't exist when the step began, then open it.
   *
   *  Needed because creating a project from the kanban does NOT navigate to it
   *  — NewProjectModal hands the row back and the board drops a card in place,
   *  by design. The tour used to wait on the project page appearing on its own,
   *  which never happened, so it sat there forever with no button to press.
   *  The tour does the navigating instead. */
  waitForNewProject?: boolean
}

export interface Tour {
  id: TourId
  /** Card + popover heading. */
  title: string
  /** One line on the Guides card. */
  summary: string
  minutes: number
  /** The opt-in modal. This IS the consent step — a tour never just starts. */
  offer: { title: string; body: string }
  steps: TourStep[]
  /** The last step offers to run another tour. */
  chainTo?: { tourId: TourId; label: string; declineLabel: string }
  /** Shown opaque, over the app, when the tour finishes — a deliberate full
   *  stop so it's obvious the walkthrough ended rather than just stopping. */
  outro?: { title: string; body: string }
  /** Shown INSTEAD of `outro` when the lesson's path gate is still false at
   *  the finish — a skipped save, or work bailed on partway. The celebration
   *  must never claim a state the Guides page will immediately contradict. */
  outroPartial?: { title: string; body: string }
  /** The path gate that says whether this guide's work actually got done.
   *  Set on lessons (guides that build real state); tours have nothing to
   *  verify and skip the check. */
  gate?: PathGate
}

// ── Tour 1 — Welcome ────────────────────────────────────────────────────────
// Runs on /sales/kanban: steps 1-3 and 5 point at the top nav (present on every
// page), but step 4's target is the board's own New project button, and step 1's
// copy describes the board. Standing on the board makes the whole tour coherent.
const WELCOME: Tour = {
  id: 'welcome',
  title: 'Welcome to MillSuite',
  summary: 'Where everything lives. The five places you’ll actually use.',
  minutes: 2,
  offer: {
    title: 'Get the lay of the land',
    body: 'A two-minute walk through where everything lives. You can quit anytime, and rerun it from Settings → Guides.',
  },
  // Chains to the rate book, not first-job: the path locks first-job until
  // the rate book has a material and a door style, and the closer's copy now
  // matches the button under it (v2 planning pass, resolves the 08-13 flag).
  chainTo: { tourId: 'rate-book', label: 'Set up my rate book', declineLabel: 'Done for now' },
  steps: [
    {
      route: '/sales/kanban',
      target: 'nav-sales',
      title: 'Sales',
      body: 'Every job starts here. The board tracks leads from first call to sold. Drag a card between columns as the deal moves.',
      placement: 'bottom',
    },
    {
      route: '/sales/kanban',
      target: 'nav-projects',
      title: 'Projects',
      body: 'Sold work lives here: the project pages, the production schedule, and the capacity calendar for planning months ahead.',
      placement: 'bottom',
    },
    {
      route: '/sales/kanban',
      target: 'nav-manage',
      title: 'Manage',
      body: 'Your rate book, reports, team, and time tracking. The rate book is the engine. Everything you price pulls from it.',
      placement: 'bottom',
    },
    {
      // Pinned: steps 1-3 spotlight nav LINKS, and the mask leaves them
      // clickable on purpose. A user who clicks the thing being pointed at
      // navigates away, and this target only exists on the board.
      route: '/sales/kanban',
      target: 'kanban-new-project',
      title: 'New project',
      body: 'This button starts a job. Name it, pick the client, and it drops onto the board.',
      placement: 'bottom',
    },
    {
      route: '/sales/kanban',
      // Owner-only in the nav. A manager running this tour skips the step
      // rather than reading about a button they can't see.
      target: 'nav-settings',
      title: 'Settings',
      body: 'Company info, invoicing, your logo, and the Guides menu where you can rerun any of these walkthroughs.',
      placement: 'bottom',
      skipIfMissing: true,
    },
    {
      // v2: the learning loop is no longer a text card here — the animated
      // welcome moment (WelcomeLoop) teaches it before this tour starts.
      title: 'That’s the map',
      body: 'Ready to set up the numbers everything prices from?',
    },
  ],
}


// ── Lesson — Set up your rate book (path step 2) ─────────────────────────────
// v2 script (specs/walkthroughs/v2-guide-system.md §6.2). This is a LESSON:
// the user builds a real material and a real door style, and the lesson is not
// done until they exist — the gate below is the same fact /api/guides/path
// checks, so the outro can't celebrate an empty catalog.
//
// Runs entirely on /rate-book. The sections are TABS (client state, no URL),
// so tab steps are DO steps advancing when that view's own content appears.
// The two form steps ring the WHOLE form and advance on the save event — the
// v1 script advanced the moment the form opened, which skipped name and price
// and let the tour walk away from an unsaved form (spec §1, failures B/C/D).
const RATE_BOOK: Tour = {
  id: 'rate-book',
  title: 'Set up your rate book',
  summary: 'One material and one door style is enough to quote a real job.',
  minutes: 4,
  gate: 'rate_book',
  offer: {
    title: 'Set up your rate book',
    body: 'You’ll add one material and one door style — for real, in your own catalog. After this you can price an actual job. About four minutes.',
  },
  chainTo: { tourId: 'first-job', label: 'Price my first job', declineLabel: 'Done for now' },
  outro: {
    title: 'Your rate book is live',
    body: 'Every quote you build from here prices off these numbers. Add more materials and styles as you go — the composer can add them mid-job too.',
  },
  outroPartial: {
    title: 'Saved for where you got to',
    body: 'Your rate book isn’t finished yet — it still needs a carcass material and a calibrated door style. Pick it up anytime from Manage → Guides.',
  },
  steps: [
    {
      route: '/rate-book',
      target: 'rate-book-tabs',
      title: 'Your pricing engine',
      body: 'Everything you quote prices from here. Set it up once, tighten it as real jobs teach you.',
      placement: 'bottom',
    },
    {
      route: '/rate-book',
      target: 'materials-tab',
      title: 'Open Materials',
      body: 'Click the Materials tab. One list, one price per material — update a price here and every product using it reprices.',
      placement: 'bottom',
      // The New material button only exists once the Materials view is up.
      advanceWhenNextAppears: true,
    },
    {
      route: '/rate-book',
      target: 'add-material',
      title: 'Add your first material',
      body: 'Click + New material. Pick a sheet good you actually buy.',
      placement: 'left',
      // Waits for the FORM (material-form), not the checkboxes inside it —
      // the v1 target here was the "Shows in" block, which is why the tour
      // seemed to jump straight to checkboxes.
      advanceWhenNextAppears: true,
    },
    {
      route: '/rate-book',
      target: 'material-form',
      title: 'Name it, price it, save it',
      body: 'Type the name and what you pay per sheet, and tick Carcass so it offers itself when you’re pricing boxes. Then click Add material.',
      placement: 'bottom',
      advanceOnEvent: 'ms:material-created',
    },
    {
      route: '/rate-book',
      target: 'materials-table',
      title: 'That’s a live price',
      body: 'Every estimate line that uses this material prices from this row. Change the number and every quote after it follows.',
      placement: 'bottom',
    },
    {
      route: '/rate-book',
      target: 'doors-tab',
      title: 'Open Doors',
      body: 'Click the Doors tab. Labor lives on the style — the material price stays in the catalog.',
      placement: 'bottom',
      advanceWhenNextAppears: true,
    },
    {
      route: '/rate-book',
      target: 'add-door-type',
      title: 'The style you build most',
      body: 'Click + New door type.',
      placement: 'left',
      advanceWhenNextAppears: true,
    },
    {
      route: '/rate-book',
      target: 'door-form',
      title: 'Enter your hours',
      body: 'Name it, put in your hours per door for each department and hardware $, then click Add door type. Hours are what make the style calibrated — it prices itself from here on.',
      placement: 'bottom',
      advanceOnEvent: 'ms:door-type-created',
    },
    {
      route: '/rate-book',
      target: 'cabinets-tab',
      title: 'Open Cabinets',
      body: 'Click the Cabinets tab.',
      placement: 'bottom',
      // Item views auto-select their first item, so the labor block exists
      // the moment the view is up — a clean appears-signal.
      advanceWhenNextAppears: true,
    },
    {
      route: '/rate-book',
      target: 'cabinet-labor',
      title: 'Your cabinet labor',
      body: 'These base-cabinet hours came from your setup answers. Tighten them as tracked jobs show you the truth.',
      placement: 'bottom',
    },
    {
      route: '/rate-book',
      title: 'You can price now',
      body: 'One material and one door style is enough for a real quote.',
    },
  ],
}

// ── Lesson — Price your first job ────────────────────────────────────────────
// v2 script (specs/walkthroughs/v2-guide-system.md §6.3). This one FOLLOWS the
// user: DO steps land on targets that only exist after they act. The project
// id isn't knowable up front — the runner captures it, later steps navigate
// back to it.
//
// The v2 fix: "Add the line" is its own DO step waiting on the save event.
// v1's "Watch the price build" carried a Next that navigated away from the
// composer with the line unsaved — the lesson's own fact (an estimate line
// exists) could be false at the finish (spec §1).
const FIRST_JOB: Tour = {
  id: 'first-job',
  title: 'Price your first job',
  summary: 'Blank board to a client-ready estimate PDF, on your real rate book.',
  minutes: 5,
  gate: 'first_job',
  offer: {
    title: 'Price your first job',
    body: 'From blank board to a client-ready estimate PDF, nine steps. Uses your real rate book, so nothing here is throwaway.',
  },
  outro: {
    title: 'That’s the whole loop',
    body: 'Lead to subproject to priced line to estimate. Everything you just did used your real rate book, so the next job works exactly the same way, only faster.',
  },
  outroPartial: {
    title: 'Almost priced',
    body: 'The job’s set up but no line is saved on it yet. Open the subproject and compose one — or resume this guide from Manage → Guides.',
  },
  steps: [
    {
      route: '/sales/kanban',
      target: 'kanban-new-project',
      title: 'Start the job',
      body: 'Click New project.',
      placement: 'bottom',
      advanceWhenNextAppears: true,
    },
    {
      route: '/sales/kanban',
      target: 'new-project-modal',
      title: 'Name it',
      body: 'Give the job a name and pick the client, or type a new client name and it’s created on the spot.',
      placement: 'right',
      // NOT advanceWhenNextAppears: saving here closes the modal and drops a
      // card on the board, it does not open the project. The tour watches for
      // the new project and opens it itself.
      waitForNewProject: true,
    },
    {
      route: (ctx) => ctx.projectPath,
      target: 'project-home',
      title: 'The project home',
      body: 'Estimate, documents, and money all live on this page. The panel on the right totals as you build.',
      placement: 'bottom',
    },
    {
      route: (ctx) => ctx.projectPath,
      target: 'add-subproject',
      title: 'Break it into subprojects',
      body: 'Click Add subproject — one per room or scope area: "Kitchen," "Bar," "Install." Each gets its own drawings and approvals later.',
      placement: 'left',
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => ctx.subprojectPath,
      target: 'compose-line',
      title: 'Compose a line',
      body: 'Click Compose line and pick what you’re building: base run, uppers, one of your own products. The composer walks through materials, doors, and features, priced from your rate book.',
      placement: 'left',
      // Opening the composer reveals the next step's target, so this waits on
      // the real click instead of putting a Next button next to one.
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => ctx.subprojectPath,
      // The composer's OWN live breakdown panel, not the subproject page's
      // sticky total — the copy is about the number moving "as you pick", and
      // the page panel sits behind the composer modal where you can't see it.
      target: 'line-breakdown',
      title: 'Watch the price build',
      body: 'Labor, materials, and consumables total live as you pick. Margins apply at the project level, so subprojects stay honest costs.',
      placement: 'left',
    },
    {
      route: (ctx) => ctx.subprojectPath,
      target: 'composer-add-line',
      title: 'Add the line',
      body: 'Click Add line. It lands on the subproject with its full breakdown saved.',
      placement: 'top',
      advanceOnEvent: 'ms:estimate-line-created',
    },
    {
      // Back to the project the user just built out.
      route: (ctx) => ctx.projectPath,
      target: 'documents-estimate',
      title: 'Send the estimate',
      body: 'Email it, download the PDF, and hit Mark as sent so the estimates list tracks what’s out the door.',
      placement: 'top',
    },
    {
      route: '/sales/kanban',
      // The card they just built, not the whole board — "drag the card to
      // Sold" should point at a card. Falls back to docking if it can't be
      // found (the board filters, or they deleted it mid-tour).
      target: 'tour-project-card',
      title: 'When they say yes',
      body: 'Drag the card to Sold. The deposit, approvals, and production steps take over from there. That’s the next guide, whenever you want it.',
      placement: 'top',
    },
  ],
}

export const TOURS: Tour[] = [WELCOME, RATE_BOOK, FIRST_JOB]

export const TOUR_IDS: TourId[] = TOURS.map((t) => t.id)

/** The dashboard's "Getting set up" checklist keeps its dismissal and its one
 *  un-observable item in the same jsonb blob as tour progress — it's the same
 *  kind of thing (per-user onboarding state) and doesn't earn a column. It is
 *  NOT a tour, so it lives here rather than in TOURS, and the API validates
 *  writes against this list rather than TOUR_IDS. */
export const SETUP_CHECKLIST_KEY = 'setup-checklist'

export const WALKTHROUGH_STATE_KEYS: string[] = [...TOUR_IDS, SETUP_CHECKLIST_KEY]

export function getTour(id: string): Tour | null {
  return TOURS.find((t) => t.id === id) ?? null
}

/** Tours are a manager-and-up thing in v1. Members live in /me and get their
 *  own guide in a later version — gate on what's true (not a member) rather
 *  than listing the roles that qualify, so a new role can't quietly opt in. */
export function canSeeTours(role: string | undefined | null): boolean {
  return !!role && role !== 'member'
}

// ============================================================================
// THE PATH — ordered, gated by REAL APP STATE (Andrew, 2026-08-12 restructure)
// ============================================================================
// The old flat catalog read as a random menu, and the teaching isn't random:
// you cannot price a job before the rate book has a material and a door type.
//
// The rule that matters: **completion is a FACT, never attendance.** A step is
// done when the shop has actually done the thing — an owner who set the rate
// book up on their own, without ever opening a guide, has completed step 2 and
// should never be told otherwise. `PathGate` names the check;
// /api/guides/path computes it.
//
// A locked step stays VISIBLE and says what unlocks it. Hiding it would hide
// the shape of the journey, which is the whole point of having one.
// ============================================================================

export type PathGate =
  | 'shop_setup'
  | 'rate_book'
  | 'first_job'
  | 'sold_to_production'
  | 'team_on_clock'
  | 'getting_paid'

export interface PathStep {
  key: PathGate
  title: string
  blurb: string
  /** Undefined until that tour is built — the step still tracks its state and
   *  can complete itself from real work. */
  tourId?: TourId
  /** Must be complete before this one opens. Null = always available. Note 5
   *  and 6 are siblings: both open once "sell it" is done. */
  after: PathGate | null
  /** Shown on the card so "done" is never mysterious. */
  doneWhen: string
}

export const PATH: PathStep[] = [
  {
    key: 'shop_setup',
    title: 'Set up your shop',
    blurb: 'Your shop rate and your base cabinet labor, the two numbers everything else is priced from.',
    tourId: 'welcome',
    after: null,
    doneWhen: 'Shop rate set and base cabinet hours entered',
  },
  {
    key: 'rate_book',
    title: 'Set up your rate book',
    blurb: 'One material and one door style is enough to quote a real job.',
    tourId: 'rate-book',
    after: 'shop_setup',
    doneWhen: 'A carcass material and a calibrated door style exist',
  },
  {
    key: 'first_job',
    title: 'Price your first job',
    blurb: 'Blank board to a client-ready estimate, on your real rate book.',
    tourId: 'first-job',
    after: 'rate_book',
    doneWhen: 'A project has at least one composed line',
  },
  {
    key: 'sold_to_production',
    title: 'Sell it, then build it',
    blurb: 'Sold, deposit, approvals, and the gates that start production.',
    after: 'first_job',
    doneWhen: 'A project reached production',
  },
  {
    key: 'team_on_clock',
    title: 'Your team on the clock',
    blurb: 'Crew logins, the phone app, and hours landing against the job.',
    after: 'sold_to_production',
    doneWhen: 'A team login exists and time has been logged',
  },
  {
    key: 'getting_paid',
    title: 'Getting paid',
    blurb: 'Invoice it, record the payment, watch the money view.',
    after: 'sold_to_production',
    doneWhen: 'A payment has been recorded',
  },
]

/** Every gate answered for one org. Computed in one round trip server-side. */
export type PathStatus = Record<PathGate, boolean>

export interface PathStepState {
  step: PathStep
  index: number
  complete: boolean
  locked: boolean
  /** The step that has to happen first, when locked. */
  blockedBy: PathStep | null
}

/** Fold the raw facts into what the page renders. Kept here, next to the
 *  definitions, so the ordering rule lives in one place. */
export function resolvePath(status: PathStatus | null): PathStepState[] {
  return PATH.map((step, index) => {
    const complete = !!status?.[step.key]
    const prereq = step.after ? PATH.find((p) => p.key === step.after) ?? null : null
    // Unknown status (still loading, or the query failed) unlocks nothing but
    // the first step — better to under-promise than to dangle a step that
    // isn't really open.
    const locked = !!prereq && !status?.[prereq.key]
    return { step, index, complete, locked, blockedBy: locked ? prereq : null }
  })
}

// ============================================================================
// THE SHELF — unordered, at your leisure
// ============================================================================
// These teach screens, not sequence, so they carry no gating and no order. All
// placeholders until their scripts are drafted; listed anyway so the rest of
// the system reads as mapped rather than missing.
// ============================================================================

export const SHELF: { title: string; summary: string }[] = [
  { title: 'Capacity calendar', summary: 'Birdseye planning. Drag work across months, read the load.' },
  { title: 'The schedule', summary: 'Day-level production planning for the shop floor.' },
  { title: 'Reports and outlook', summary: 'What jobs actually cost, and what is booked ahead.' },
  { title: 'Change orders', summary: 'Price a change, get it approved, get it invoiced.' },
  { title: 'Deep dive: materials catalog', summary: 'One price per material, everywhere it is used.' },
  { title: 'Deep dive: custom products', summary: 'Build your own product and price it like a built-in.' },
  { title: 'Deep dive: features and calibration', summary: 'Face frames, LED, and teaching the system your hours.' },
  { title: 'The worker app', summary: 'What your crew sees on a phone. Lives inside My work.' },
]
