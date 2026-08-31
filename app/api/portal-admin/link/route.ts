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

/** Absolute base for the link the shop is about to paste into an email. Falls
 *  back to the request's own origin so preview deploys hand out preview links
 *  rather than production ones. */
function baseUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/+$/, '')
  return req.nextUrl.origin
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
