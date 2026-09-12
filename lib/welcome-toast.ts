// ============================================================================
// lib/welcome-toast.ts — the handoff from the setup overlay to the home page.
// ============================================================================
// ONE pair of names, shared by the writer (components/onboarding/
// WelcomeOverlay) and the reader (the toast on /pm). They used to be two
// separate string literals in two files, which is how the reader ended up
// listening for something nobody sent.
//
// ⛔ THE EVENT IS NOT OPTIONAL — the localStorage key alone does not work.
// The overlay finishes on top of an ALREADY-MOUNTED /pm and navigates to /pm,
// which is the same route segment: React re-renders instead of remounting, so
// a mount-time read never happens. The key covers the case where the user
// finishes somewhere else and arrives fresh; the event covers the case where
// they're already here. Both are needed.
// ============================================================================

export const WELCOME_TOAST_KEY = 'millsuite.welcomeJustCompleted'
export const WELCOME_TOAST_EVENT = 'ms:welcome-complete'

/** Called by the overlay the moment onboarding completes. */
export function announceWelcomeComplete() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(WELCOME_TOAST_KEY, '1')
  window.dispatchEvent(new CustomEvent(WELCOME_TOAST_EVENT))
}
