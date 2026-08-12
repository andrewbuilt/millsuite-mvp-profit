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

export type TourId = 'welcome' | 'first-job'

/** What the engine has learned while the tour runs. The first-job tour follows
 *  the user into a project it can't know the id of up front. */
export interface TourContext {
  /** '/projects/<id>' — captured the first time the tour sees a project page. */
  projectPath: string | null
}

export interface TourStep {
  /** Where the step lives. A string navigates there; a function builds the path
   *  from what the tour has learned. Returning null means "stay put". */
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
  /** A missing target is expected here, so drop the step rather than falling
   *  back to a centered popover. Settings is owner-only. */
  skipIfMissing?: boolean
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
}

// ── Tour 1 — Welcome ────────────────────────────────────────────────────────
// Runs on /sales/kanban: steps 1-3 and 5 point at the top nav (present on every
// page), but step 4's target is the board's own New project button, and step 1's
// copy describes the board. Standing on the board makes the whole tour coherent.
const WELCOME: Tour = {
  id: 'welcome',
  title: 'Welcome to MillSuite',
  summary: 'Where everything lives — the five places you’ll actually use.',
  minutes: 2,
  offer: {
    title: 'Get the lay of the land',
    body: 'A two-minute walk through where everything lives. You can quit anytime, and rerun it from Settings → Guides.',
  },
  chainTo: { tourId: 'first-job', label: 'Price my first job', declineLabel: 'Done for now' },
  steps: [
    {
      route: '/sales/kanban',
      target: 'nav-sales',
      title: 'Sales',
      body: 'Every job starts here. The board tracks leads from first call to sold — drag a card between columns as the deal moves.',
      placement: 'bottom',
    },
    {
      target: 'nav-projects',
      title: 'Projects',
      body: 'Sold work lives here: the project pages, the production schedule, and the capacity calendar for planning months ahead.',
      placement: 'bottom',
    },
    {
      target: 'nav-manage',
      title: 'Manage',
      body: 'Your rate book, reports, team, and time tracking. The rate book is the engine — everything you price pulls from it.',
      placement: 'bottom',
    },
    {
      target: 'kanban-new-project',
      title: 'New project',
      body: 'This button starts a job — name it, pick the client, and it drops onto the board.',
      placement: 'bottom',
    },
    {
      // Owner-only in the nav. A manager running this tour skips the step
      // rather than reading about a button they can't see.
      target: 'nav-settings',
      title: 'Settings',
      body: 'Company info, invoicing, your logo — and the Guides menu, where you can rerun any of these walkthroughs.',
      placement: 'bottom',
      skipIfMissing: true,
    },
    {
      // Centered: the learning loop is a concept, not a place on screen.
      title: 'The learning loop',
      body: 'You estimate hours, your team tracks actual hours, and the system shows the difference — every job makes the next quote smarter.',
    },
    {
      title: 'That’s the map',
      body: 'Ready to price your first job?',
    },
  ],
}

// ── Tour 2 — Price your first job ───────────────────────────────────────────
// This one FOLLOWS the user. Steps 2, 3 and 5 land on targets that only exist
// after they act, so those steps advance on appearance instead of on Next. The
// project id isn't knowable up front — step 3 captures it, step 7 navigates back
// to it.
const FIRST_JOB: Tour = {
  id: 'first-job',
  title: 'Price your first job',
  summary: 'Blank board to a client-ready estimate PDF, on your real rate book.',
  minutes: 5,
  offer: {
    title: 'Price your first job',
    body: 'From blank board to a client-ready estimate PDF, eight steps. Uses your real rate book — nothing here is throwaway.',
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
      target: 'new-project-modal',
      title: 'Name it',
      body: 'Give the job a name and pick the client — or type a new client name and it’s created on the spot.',
      placement: 'right',
      advanceWhenNextAppears: true,
    },
    {
      target: 'project-home',
      title: 'The project home',
      body: 'Estimate, documents, and money all live on this page. The panel on the right totals as you build.',
      placement: 'bottom',
    },
    {
      target: 'add-subproject',
      title: 'Break it into subprojects',
      body: 'One per room or scope area — "Kitchen," "Bar," "Install." Each gets its own drawings and approvals later.',
      placement: 'left',
      advanceWhenNextAppears: true,
    },
    {
      target: 'compose-line',
      title: 'Compose a line',
      body: 'Pick what you’re building — base run, uppers, one of your own products. The composer walks through materials, doors, and features, priced from your rate book.',
      placement: 'left',
    },
    {
      target: 'line-breakdown',
      title: 'Watch the price build',
      body: 'Labor, materials, and consumables total live as you pick. Margins apply at the project level, so subprojects stay honest costs.',
      placement: 'left',
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
      target: 'kanban-board',
      title: 'When they say yes',
      body: 'Drag the card to Sold. The deposit, approvals, and production steps take over from there — that’s the next guide, whenever you want it.',
      placement: 'top',
    },
  ],
}

export const TOURS: Tour[] = [WELCOME, FIRST_JOB]

export const TOUR_IDS: TourId[] = TOURS.map((t) => t.id)

export function getTour(id: string): Tour | null {
  return TOURS.find((t) => t.id === id) ?? null
}

/** Tours are a manager-and-up thing in v1. Members live in /me and get their
 *  own guide in a later version — gate on what's true (not a member) rather
 *  than listing the roles that qualify, so a new role can't quietly opt in. */
export function canSeeTours(role: string | undefined | null): boolean {
  return !!role && role !== 'member'
}

// ── Coming soon ─────────────────────────────────────────────────────────────
// Listed on the Guides page, greyed, no button. These are the v2/v3 rows from
// the spec catalog — showing them is the point: it tells a new owner the rest
// of the system is mapped, not missing.
export const COMING_SOON: { title: string; summary: string }[] = [
  { title: 'Sell it: kanban to production', summary: 'Sold, deposit, approvals, production gates, schedule.' },
  { title: 'Capacity calendar', summary: 'Birdseye planning — drag work across months, read the load.' },
  { title: 'Rate book basics', summary: 'Items, materials, doors, features — where your prices come from.' },
  { title: 'Change orders', summary: 'Price a change, get it approved, get it invoiced.' },
  { title: 'Your team + the worker app', summary: 'Logins, time tracking, PTO, and what your crew sees on a phone.' },
]
