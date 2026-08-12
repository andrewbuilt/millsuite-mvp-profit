// ============================================================================
// lib/reserved-slugs.ts — top-level paths an org slug must never shadow
// ============================================================================
// Org slugs live at the ROOT of the URL space: millsuite.com/{slug} is a
// shop's login page. So every real top-level route is a name an org must not
// be able to take — a shop called "Dashboard" would otherwise claim /dashboard
// and shadow the app.
//
// This is the single source of truth for two consumers that used to disagree:
//   • lib/auth-context — decides whether a first path segment is a shop slug
//     or a real route (a real route must stay public-gated normally).
//   • /api/auth/setup — the SIGNUP path, which had NO check at all. The slug
//     is derived from the shop name, so "Bam Login" or a shop literally named
//     "Settings" would have taken a reserved word. Nothing collided in
//     practice because orgs.slug is unique against OTHER ORGS, not against
//     routes.
//
// Adding a new top-level route? Add it here in the same commit, or an org can
// take the name out from under it.
// ============================================================================

export const RESERVED_SLUGS = new Set([
  // Infrastructure / marketing
  'api',
  'join',
  'login',
  'signup',
  'pricing',
  'cancellation-policy',
  'reset-password',
  // App routes
  'capacity',
  'change-orders',
  'clients',
  'dashboard',
  'estimates',
  'guides',
  'invoices',
  'me',
  'projects',
  'qb-reconciliation',
  'rate-book',
  'reports',
  'sales',
  'schedule',
  'settings',
  'suggestions',
  'team',
  'time',
  // Held back so they stay available rather than being claimed by a shop.
  'admin',
  'app',
  'auth',
  'billing',
  'help',
  'support',
  'docs',
  'status',
  'onboarding',
  'password',
  'portal', // /{slug}/portal is the worker login — a shop named "Portal" would be confusing at best
])

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase())
}

/** A slug that's safe to give an org: reserved words get a suffix rather than
 *  being rejected, so signup never dead-ends on the shop's name. */
export function deconflictSlug(slug: string): string {
  return isReservedSlug(slug) ? `${slug}-shop` : slug
}
