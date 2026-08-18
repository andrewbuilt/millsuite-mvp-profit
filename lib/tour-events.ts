// ============================================================================
// lib/tour-events.ts — the save signals lessons advance on (guide system v2)
// ============================================================================
// A DO step that asks the user to fill a form must advance on the RESULT — the
// row actually saved — not on the form appearing or a button being clicked.
// "Target appears" fires the instant a form opens, which is how the rate-book
// tour skipped past name and price (spec §1, failure B). So the app announces
// its saves, and the runner listens (`TourStep.advanceOnEvent`).
//
// Rules:
//   • Fire AFTER the successful await, never before — a failed save must not
//     advance a lesson past work that didn't happen.
//   • Creates only, not edits: the lessons teach making the first one.
//   • Plain TS, no React — same reason as lib/walkthroughs.
//
// scripts/check-tour-targets.mjs validates every advanceOnEvent in a tour
// script against TOUR_EVENTS, so a typo'd event name fails the check instead
// of silently never firing.

export type TourEvent =
  | 'ms:material-created'
  | 'ms:door-type-created'
  | 'ms:estimate-line-created'
  | 'ms:project-sold'
  | 'ms:deposit-received'
  | 'ms:production-started'
  | 'ms:team-member-added'
  | 'ms:worker-login-created'
  | 'ms:payment-recorded'

export const TOUR_EVENTS: TourEvent[] = [
  'ms:material-created',
  'ms:door-type-created',
  'ms:estimate-line-created',
  'ms:project-sold',
  'ms:deposit-received',
  'ms:production-started',
  'ms:team-member-added',
  'ms:worker-login-created',
  'ms:payment-recorded',
]

/** Announce a save a walkthrough may be waiting on. Safe to call
 *  unconditionally — with no tour running, nobody is listening. */
export function announce(name: TourEvent) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name))
}
