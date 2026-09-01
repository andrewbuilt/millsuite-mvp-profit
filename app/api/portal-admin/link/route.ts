// ============================================================================
// POST /api/portal-admin/link — mint / fetch / regenerate a client portal link
// ============================================================================
// Shop-side, Bearer-authenticated. The token is a bearer credential for that
// client's entire portal, so it is minted server-side on the service role and
// the client row is always re-checked against the CALLER's org before anything
// is read or written — otherwise any authenticated user on the platform could
// mint a link into another shop's client.
//
// Regenerating overwrites the column, which instantly dead-links every URL
// already sent. That is the revoke story, and it's why the response says so.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { mintPortalToken } from '@/lib/client-portal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Absolute base for the link the shop is about to paste into an email. This
 * one function has now produced two different broken links, so both traps are
 * written down rather than summarised.
 *
 * ⛔ TRAP 1 — a hand-set constant rots. This first read `NEXT_PUBLIC_APP_URL ||
 * NEXT_PUBLIC_SITE_URL`, one of which is set on prod to `app.millsuite.com`, a
 * host with NO DNS RECORD. The first link Andrew copied was dead on arrival
 * (DNS_PROBE_FINISHED_NXDOMAIN), and this route was the only consumer of those
 * variables, so the stale value had no other symptom to catch it. **Do not
 * reintroduce a manually configured URL here.**
 *
 * ⛔ TRAP 2 — the request host is whatever the SHOP happens to be browsing,
 * which on Vercel is often a per-deployment URL like
 * `millsuite-mvp-profit-3yvwt9k3q-andrew-watsons-projects-4a21bd73.vercel.app`.
 * Deriving purely from the request replaced a dead 22-character host with a
 * live 74-character one, in a link that gets texted to clients. Correct, and
 * still unusable.
 *
 * So: on production, use `VERCEL_PROJECT_PRODUCTION_URL` — the project's real
 * production domain, injected by the platform, so unlike a hand-set variable it
 * cannot drift from reality. Anywhere else (preview deploys, localhost) fall
 * back to the request host, because on a preview the whole point is to test
 * THAT deployment and a production link would defeat it.
 *
 * The request fallback prefers forwarded headers: behind Vercel's proxy those
 * carry the public host, while nextUrl.origin can reflect the internal one.
 */
function baseUrl(req: NextRequest): string {
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

export async function POST(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId) return unauthorized()

  const body = (await req.json().catch(() => null)) as { clientId?: string; regenerate?: boolean } | null
  const clientId = String(body?.clientId || '')
  if (!clientId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  // Tenant isolation: the client must belong to the caller's org.
  const { data: row } = await supabaseAdmin
    .from('clients')
    .select('id, portal_token, portal_token_issued_at')
    .eq('id', clientId)
    .eq('org_id', caller.orgId)
    .maybeSingle()
  const client = row as { id: string; portal_token: string | null; portal_token_issued_at: string | null } | null
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let token = client.portal_token
  let issuedAt = client.portal_token_issued_at

  if (!token || body?.regenerate) {
    token = mintPortalToken()
    issuedAt = new Date().toISOString()
    const { data: updated, error } = await supabaseAdmin
      .from('clients')
      .update({ portal_token: token, portal_token_issued_at: issuedAt })
      .eq('id', clientId)
      .eq('org_id', caller.orgId)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Nothing was updated' }, { status: 500 })
    }
  }

  return NextResponse.json({ url: `${baseUrl(req)}/portal/${token}`, issuedAt })
}
