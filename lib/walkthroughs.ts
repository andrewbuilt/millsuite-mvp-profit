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

export type TourId =
  | 'welcome'
  | 'rate-book'
  | 'first-job'
  | 'sold-to-production'
  | 'team-on-clock'
  | 'getting-paid'

/** What the engine has learned while the tour runs. The first-job tour follows
 *  the user into a project it can't know the id of up front. */
export interface TourContext {
  /** '/projects/<id>' — captured the first time the tour sees a project page. */
  projectPath: string | null
  /** '/projects/<id>/subprojects/<id>' — same, one level down. */
  subprojectPath: string | null
  /** '/invoices/<id>' — captured when the tour follows the user into an
   *  invoice (the getting-paid lesson can't know the id up front). */
  invoicePath: string | null
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
  /** Numbered list rendered between title and body — for steps that teach a
   *  short sequence the user works through before pressing Next. Body then
   *  reads as the closing line. */
  bullets?: string[]
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
  /** Park the card in the bottom corner instead of centering it. For steps
   *  where the user needs the whole page to work (finish a list of
   *  approvals) — a centered card sits exactly where the work is. Use on
   *  targetless steps. */
  dock?: boolean
  /** Keep the ring even when the target is bigger than the engine's
   *  "that's the whole page" threshold. For workspace-sized targets (the
   *  spec list with a card expanded) where the ring means "work in here". */
  ringLarge?: boolean
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
  // Copy: Andrew's pass, 2026-08-14. Plain shop language, no em dashes.
  offer: {
    title: 'Set up your rate book',
    body: 'You’ll add one material and one door style to your own catalog. After this you can price an actual job. About four minutes.',
  },
  chainTo: { tourId: 'first-job', label: 'Price my first job', declineLabel: 'Done for now' },
  outro: {
    title: 'Your rate book is live',
    body: 'Every quote pulls its numbers from the rate book. Add materials anytime, here or mid-job in the line composer.',
  },
  outroPartial: {
    title: 'Saved for where you got to',
    body: 'Your rate book isn’t finished yet. It still needs a material and a calibrated door style. Pick it up anytime from Manage → Guides.',
  },
  steps: [
    {
      route: '/rate-book',
      target: 'rate-book-tabs',
      title: 'Your pricing engine',
      body: 'Everything you quote pulls its prices from this rate book. Use your best judgment for the initial setup. As your team tracks real jobs, MillSuite shows you the actual numbers so you can keep these honest.',
      placement: 'bottom',
    },
    {
      route: '/rate-book',
      target: 'materials-tab',
      title: 'Add a material',
      body: 'Let’s add a new material. Click the Materials tab to open the catalog.',
      placement: 'bottom',
      // The New material button only exists once the Materials view is up.
      advanceWhenNextAppears: true,
    },
    {
      route: '/rate-book',
      target: 'add-material',
      title: 'Add your first material',
      body: 'Click + New material.',
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
      body: 'Start with a veneered sheet good. Name it the way you already say it, like 3/4 MDF Quartersawn White Oak, and enter what you pay per sheet. Tick Door to put it in the estimator’s Door quick-pick list; a material can sit in several lists, and anything unticked is still findable while pricing. Then click Add material.',
      placement: 'bottom',
      advanceOnEvent: 'ms:material-created',
    },
    {
      route: '/rate-book',
      target: 'materials-table',
      title: 'That’s a live price',
      body: 'Adding and editing materials is that easy. Every estimate line that uses this material prices from this row, so change the number here and every quote after it follows.',
      placement: 'bottom',
    },
    {
      route: '/rate-book',
      target: 'doors-tab',
      title: 'Add a door style',
      body: 'Click the Doors tab. Labor hours for each door style live here. The door’s material price stays in the materials catalog.',
      placement: 'bottom',
      advanceWhenNextAppears: true,
    },
    {
      route: '/rate-book',
      target: 'add-door-type',
      title: 'Add a door type',
      body: 'Click + New door type.',
      placement: 'left',
      advanceWhenNextAppears: true,
    },
    {
      route: '/rate-book',
      target: 'door-form',
      title: 'Enter your labor hours',
      body: 'Name the style. Slab is already covered by the cabinet wizard, so add a door you actually build, like Micro Shaker. Enter your shop’s hours to build 8 feet of this door, about 4 doors, in each department, plus hardware. MillSuite stores it per door and prices any length from there. Click Add door type.',
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
      body: 'These base cabinet hours came from your setup answers. Combined with your materials and door styles, they can price nearly any cabinet you build. Edit them anytime, and as your team tracks time you’ll see what the hours really are.',
      placement: 'bottom',
    },
    {
      route: '/rate-book',
      title: 'All set!',
      body: 'You’re ready to price your first cabinet job. Come back to this walkthrough anytime you need a refresher.',
    },
  ],
}

// ── Lesson — Price your first job ────────────────────────────────────────────
// v2.1 script (Andrew's copy pass, 2026-08-14). This one FOLLOWS the user:
// DO steps land on targets that only exist after they act. The project id
// isn't knowable up front — the runner captures it, later steps navigate
// back to it.
//
// The composer now gets real steps of its own (pick a composer, set the
// quantity, work the slots) instead of one card for the whole modal, and
// "Add the line" waits on the save event so the lesson can't finish with
// nothing priced.
const FIRST_JOB: Tour = {
  id: 'first-job',
  title: 'Price your first job',
  summary: 'Blank board to a client-ready estimate PDF, on your real rate book.',
  minutes: 5,
  gate: 'first_job',
  offer: {
    title: 'Price your first job',
    body: 'From empty project to a client-ready estimate. Projects are easy to edit and delete, so use a real job or a throwaway, whichever you like.',
  },
  outro: {
    title: 'That’s the whole loop',
    body: 'Lead to subproject to priced line to estimate. Everything you just did used your real rate book, so the next job works exactly the same way, only faster.',
  },
  outroPartial: {
    title: 'Almost priced',
    body: 'The job’s set up but no line is saved on it yet. Open the subproject and compose one, or resume this guide from Manage → Guides.',
  },
  chainTo: { tourId: 'sold-to-production', label: 'Sell my project', declineLabel: 'Done for now' },
  steps: [
    {
      route: '/sales/kanban',
      target: 'kanban-new-project',
      title: 'Let’s price our first job',
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
      title: 'Welcome to the project page',
      body: 'Projects are made up of subprojects. Think of MillSuite HQ as the project, with Breakroom Cabinetry, Conference Table, and Reception Desk as its subprojects. At a glance this page shows the status, the pricing, and the subproject list, with links to estimates, invoices, documents, and the client.',
      placement: 'bottom',
    },
    {
      route: (ctx) => ctx.projectPath,
      target: 'add-subproject',
      title: 'Let’s make our first subproject',
      body: 'A subproject is an area of the project and a line on the estimate. A kitchen and a pantry can share one if they use the same materials. When materials differ, like a painted shaker kitchen with a walnut island, split them into two. Click Add subproject and give it a name.',
      placement: 'left',
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => ctx.subprojectPath,
      target: 'compose-line',
      title: 'This is the subproject page',
      body: 'Subprojects are made up of composed lines. A typical kitchen might carry base cabinets, uppers, and full height cabs as three lines, so when the client swaps 4 feet of base for 4 feet of full height, you adjust two lines and the price follows. Click + Compose line.',
      placement: 'left',
      // Opening the composer reveals the product picker, the next target.
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => ctx.subprojectPath,
      target: 'composer-products',
      title: 'Pick a composer',
      body: 'These are premade composers for cabinets and solid wood parts. Let’s price a run of base cabinets. Select Base cabinet run.',
      placement: 'top',
      // Picking a cabinet product reveals the quantity field.
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => ctx.subprojectPath,
      target: 'composer-qty',
      title: 'Selections left, pricing right',
      body: 'Your picks build on the left and the price breaks down live on the right. Start by setting the quantity to 20 LF.',
      placement: 'right',
    },
    {
      route: (ctx) => ctx.subprojectPath,
      target: 'composer-form',
      title: 'Work your way down',
      body: 'Pick a material for each part as you go. Missing one? Click Add new, type a name and cost, and it goes straight into your rate book. End panels run 24 inches deep and scribes 3 inches wide, priced from your door style. For oversized pieces, add quantity or raise the margin. Drawers can be set up here too.',
      placement: 'right',
    },
    {
      route: (ctx) => ctx.subprojectPath,
      target: 'composer-add-line',
      title: 'Let’s add this line',
      body: 'Click Add line.',
      placement: 'top',
      advanceOnEvent: 'ms:estimate-line-created',
    },
    {
      // Back to the project the user just built out.
      route: (ctx) => ctx.projectPath,
      target: 'project-subprojects',
      title: 'Here it is, your first project',
      body: 'Your subprojects are listed with their totals to the right. Margins can be adjusted on the fly here, or permanently in Settings.',
      placement: 'right',
    },
    {
      route: (ctx) => ctx.projectPath,
      target: 'documents-estimate',
      title: 'Next, let’s send the estimate',
      body: 'Select Download and get this out to the client. Mark as sent keeps your estimates list up to date on what’s out the door.',
      placement: 'top',
    },
    {
      route: '/sales/kanban',
      // The card they just built, not the whole board. Falls back to docking
      // if it can't be found (the board filters, or they deleted it mid-tour).
      target: 'tour-project-card',
      title: 'The sales funnel',
      body: 'As a job gets closer to selling, drag its card toward Sold. We use New Leads for pricing in progress, 50/50 for first-time clients, and 90% for repeat clients. Selling a project is the next guide. See you there.',
      placement: 'top',
    },
  ],
}

// ── Lesson — Sell it, then build it (path step 4) ────────────────────────────
// The user walks their priced job through the two gates: deposit and
// approvals, then starts production. Every DO step advances on the real
// state change (stage write, deposit recorded, production started), so the
// guide can't outrun the job.
const SOLD_TO_PRODUCTION: Tour = {
  id: 'sold-to-production',
  title: 'Sell it, then build it',
  summary: 'Sold, deposit, approvals, and the button that starts production.',
  minutes: 5,
  gate: 'sold_to_production',
  offer: {
    title: 'Sell it, then build it',
    body: 'A job needs two things before the shop can start: the deposit and the approvals. This guide walks a sold job through both. About five minutes.',
  },
  chainTo: { tourId: 'team-on-clock', label: 'Set up my team', declineLabel: 'Done for now' },
  outro: {
    title: 'That’s how a job reaches the floor',
    body: 'Deposit, approvals, then production. Every job takes this same path, so nothing starts before it’s paid for and signed off.',
  },
  outroPartial: {
    title: 'Not in production yet',
    body: 'This job is still missing its deposit or an approval. The buttons on the project page tell you which. Pick this up anytime from Manage → Guides.',
  },
  steps: [
    {
      route: '/sales/kanban',
      target: 'kanban-board',
      title: 'Let’s sell a job',
      body: 'Find the job you priced and drag its card into Sold.',
      placement: 'bottom',
      advanceOnEvent: 'ms:project-sold',
    },
    {
      route: '/sales/kanban',
      target: 'kanban-board',
      title: 'Open the project',
      body: 'Click the card to open it.',
      placement: 'bottom',
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => ctx.projectPath,
      target: 'project-status',
      title: 'We’re in pre-production',
      body: 'The job is sold, and the project is officially in pre-production. Two things get any job into production: the down payment and the approvals.',
      placement: 'bottom',
    },
    {
      route: (ctx) => ctx.projectPath,
      target: 'mark-deposit',
      title: 'Record the deposit',
      body: 'When the money lands, click Mark deposit received. MillSuite creates the invoice and records the payment for you.',
      placement: 'bottom',
      advanceOnEvent: 'ms:deposit-received',
    },
    {
      route: (ctx) => ctx.projectPath,
      target: 'pre-production-link',
      title: 'Now the approvals',
      body: 'Click Pre-production.',
      placement: 'bottom',
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => (ctx.projectPath ? `${ctx.projectPath}/pre-production` : null),
      target: 'approval-gate',
      title: 'Get approved',
      // Copy follows the wave-2 redesign: the strip counts materials, drawings
      // and the deposit now, not approved / in review / pending.
      body: 'Every project needs its drawings and samples approved. This strip is the quick view: materials, drawings, and whether the deposit has landed.',
      placement: 'bottom',
    },
    {
      route: (ctx) => (ctx.projectPath ? `${ctx.projectPath}/pre-production` : null),
      // One workspace step for the whole materials pass (Andrew, after two
      // live runs: event-per-state made the cards fight the work). The ring
      // covers the spec LIST (cards expand and shift as states change), the
      // numbered list teaches the sequence, and Next is pressed when
      // everything's approved.
      target: 'spec-list',
      title: 'Approve the materials',
      bullets: [
        // Whole-row click landed with the wave-2 redesign; the chevron is
        // still there, but it's no longer the only target.
        'Click a spec row to open it.',
        'Press Sample submitted. It gets a timestamp.',
        'Try a revision: press Client requested change.',
        'Now submit it again.',
        'And finally, approve it.',
      ],
      body: 'That’s the whole process for materials and finishes. Approve all the others the same way, then press Next.',
      placement: 'right',
      ringLarge: true,
    },
    {
      route: (ctx) => (ctx.projectPath ? `${ctx.projectPath}/pre-production` : null),
      target: 'drawings-approve',
      title: 'Approve the drawings',
      body: 'Click Mark approved manually for now. Do the same on each subproject. When your drawings live in MillSuite, you’ll approve the revision itself.',
      placement: 'left',
      advanceOnEvent: 'ms:drawings-approved',
    },
    {
      route: (ctx) => (ctx.projectPath ? `${ctx.projectPath}/pre-production` : null),
      target: 'approval-gate',
      title: 'Everything is green lit',
      body: 'The production gate is green: every material and drawing on this project reads approved.',
      placement: 'bottom',
    },
    {
      route: (ctx) => (ctx.projectPath ? `${ctx.projectPath}/pre-production` : null),
      target: 'back-to-project',
      title: 'Head back',
      body: 'Press Back to project.',
      placement: 'bottom',
      // The next step's target (the Start production button) only exists on
      // the project page once every gate is clear.
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => ctx.projectPath,
      target: 'start-production',
      title: 'Start production',
      body: 'Click Start production. If you don’t see the button, the deposit or an approval is still missing.',
      placement: 'bottom',
      advanceOnEvent: 'ms:production-started',
    },
    {
      route: (ctx) => ctx.projectPath,
      target: 'project-status',
      title: 'Ready for the shop floor',
      body: 'This project is in production. Next we’ll look at the schedule and see what happens when time is tracked on this job.',
      placement: 'bottom',
    },
  ],
}

// ── Lesson — Your team on the clock (path step 5) ───────────────────────────
// Mostly setup the owner can finish in one sitting, plus one fact that can't
// be forced from this chair: a worker actually clocking in. The partial outro
// says exactly that, kindly — it's the normal way this lesson ends.
const TEAM_ON_CLOCK: Tour = {
  id: 'team-on-clock',
  title: 'Your team on the clock',
  summary: 'Add your crew, give them logins, and watch hours land on jobs.',
  minutes: 3,
  gate: 'team_on_clock',
  offer: {
    title: 'Your team on the clock',
    body: 'Add your crew, give them logins, and see where their hours land. About three minutes.',
  },
  chainTo: { tourId: 'getting-paid', label: 'Get paid', declineLabel: 'Done for now' },
  outro: {
    title: 'Your team is on',
    body: 'Logins are set and hours land where the work happened. Real hours against estimated hours is where your numbers start telling the truth.',
  },
  outroPartial: {
    title: 'One thing left',
    body: 'The setup is done. This step finishes on its own the first time someone clocks time on a job.',
  },
  steps: [
    {
      route: '/team',
      target: 'team-members',
      title: 'This is your team page',
      body: 'Everyone who works in the shop goes here. Their pay and hours are what your shop rate is built from.',
      placement: 'bottom',
    },
    {
      route: '/team',
      target: 'team-add-member',
      title: 'Add a person',
      body: 'Click + Add Member.',
      placement: 'left',
      advanceWhenNextAppears: true,
    },
    {
      route: '/team',
      target: 'team-member-form',
      title: 'Name them',
      body: 'Type their name and click Add. Pay and details can be filled in on their row after.',
      placement: 'bottom',
      advanceOnEvent: 'ms:team-member-added',
    },
    {
      route: '/team',
      target: 'team-roster',
      title: 'Set them up',
      body: 'Open their row to set departments and hours. A person’s departments decide which jobs show up on their clock.',
      placement: 'top',
    },
    {
      route: '/team',
      target: 'team-roster',
      title: 'Give them a login',
      body: 'Find Create login on their row. Set an email and a password, and pick Worker. Workers get the time clock. Managers get the whole shop.',
      placement: 'top',
      advanceOnEvent: 'ms:worker-login-created',
    },
    {
      route: '/team',
      title: 'The phone app',
      body: 'Workers sign in at millsuite.com/your-shop/portal on their phone. They clock in on a job, clock out, see their week, and request time off.',
    },
    {
      route: '/time',
      title: 'Hours land on jobs',
      body: 'This page shows every hour your team tracks. Each hour lands on the job it was worked, so every project shows estimated hours against real ones.',
    },
    {
      route: '/time',
      title: 'That’s the clock',
      body: 'This step checks itself off the first time someone clocks in on a job.',
    },
  ],
}

// ── Lesson — Getting paid (path step 6) ─────────────────────────────────────
const GETTING_PAID: Tour = {
  id: 'getting-paid',
  title: 'Getting paid',
  summary: 'Where invoices live, and what to do when the money lands.',
  minutes: 3,
  gate: 'getting_paid',
  offer: {
    title: 'Getting paid',
    body: 'Where invoices live, and how to record a payment when the money lands. About three minutes.',
  },
  outro: {
    title: 'You got paid',
    body: 'Priced, sold, built, tracked, and paid. From here it’s just more jobs, and every one makes your numbers sharper.',
  },
  outroPartial: {
    title: 'When the money lands',
    body: 'No payment is recorded yet. When one comes in, open the invoice and click Record payment. This step finishes itself.',
  },
  steps: [
    {
      route: '/invoices',
      target: 'invoices-summary',
      title: 'This is your money page',
      body: 'Outstanding is what clients owe you. Overdue needs a phone call. Paid this month is the good news.',
      placement: 'bottom',
    },
    {
      route: '/invoices',
      target: 'invoices-table',
      title: 'Every invoice in one list',
      body: 'Deposits, milestones, and change orders all land here. MillSuite creates most of them for you, like the deposit invoice when you sold your job.',
      placement: 'top',
    },
    {
      route: '/invoices',
      target: 'invoices-table',
      title: 'Open one',
      body: 'Click an invoice to open it.',
      placement: 'top',
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => ctx.invoicePath,
      target: 'invoice-detail',
      title: 'The invoice',
      body: 'Send it, download the PDF, and watch the balance at the bottom. The client gets a clean bill. You see what’s been paid against it.',
      placement: 'bottom',
    },
    {
      route: (ctx) => ctx.invoicePath,
      target: 'invoice-payments',
      title: 'Money came in',
      body: 'Click Record payment. If the invoice is still a draft, send it first.',
      placement: 'top',
      advanceWhenNextAppears: true,
    },
    {
      route: (ctx) => ctx.invoicePath,
      target: 'payment-modal',
      title: 'Write it down',
      body: 'Enter the amount and the date, then click Record payment. Set to balance due fills in the full amount for you.',
      placement: 'right',
      advanceOnEvent: 'ms:payment-recorded',
    },
    {
      route: (ctx) => ctx.invoicePath,
      target: 'invoice-payments',
      title: 'Paid down',
      body: 'The balance drops and the status updates on its own: partial until it’s covered, then paid.',
      placement: 'top',
    },
    {
      route: (ctx) => ctx.invoicePath,
      title: 'That’s the whole loop',
      body: 'Price it, build it, track it, get paid. If you invoice through QuickBooks, payments recorded there apply here on their own.',
    },
  ],
}

export const TOURS: Tour[] = [
  WELCOME,
  RATE_BOOK,
  FIRST_JOB,
  SOLD_TO_PRODUCTION,
  TEAM_ON_CLOCK,
  GETTING_PAID,
]

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
    doneWhen: 'A material and a calibrated door style exist',
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
    tourId: 'sold-to-production',
    after: 'first_job',
    doneWhen: 'A project reached production',
  },
  {
    key: 'team_on_clock',
    title: 'Your team on the clock',
    blurb: 'Crew logins, the phone app, and hours landing against the job.',
    tourId: 'team-on-clock',
    after: 'sold_to_production',
    doneWhen: 'A team login exists and time has been logged',
  },
  {
    key: 'getting_paid',
    title: 'Getting paid',
    blurb: 'Invoice it, record the payment, watch the money view.',
    tourId: 'getting-paid',
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
