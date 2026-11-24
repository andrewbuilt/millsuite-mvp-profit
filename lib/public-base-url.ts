// ============================================================================
// lib/public-base-url.ts — the absolute base for a link the shop will SEND
// ============================================================================
// Same rule as app/api/portal-admin/link (read the two traps written there
// before touching this): on production use VERCEL_PROJECT_PRODUCTION_URL — the
// platform-injected real domain, which can't rot like a hand-set constant and
// isn't the 74-character per-deployment host the shop happens to be browsing.
// Anywhere else (preview, localhost) use the request's own host, forwarded
// headers first.
// ============================================================================

import type { NextRequest } from 'next/server'

export function publicBaseUrl(req: NextRequest): string {
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (process.env.VERCEL_ENV === 'production' && prodHost) {
    return `https://${prodHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  }
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  if (host) {
    const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
    return `${proto}://${host}`.replace(/\/+$/, '')
  }
  return req.nextUrl.origin.replace(/\/+$/, '')
}
