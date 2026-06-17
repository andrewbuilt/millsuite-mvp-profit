import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/quickbooks'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Intuit redirects the browser here after the user consents. This is a
// top-level navigation with no Authorization header, so we trust `state` (the
// org id we set at connect time) to know which org to attach the connection to.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const code = sp.get('code')
  const realmId = sp.get('realmId')
  const orgId = sp.get('state')
  const error = sp.get('error')

  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/settings?${qs}`, req.url))

  if (error) return back(`qb=error&reason=${encodeURIComponent(error)}`)
  if (!code || !realmId || !orgId) return back('qb=error&reason=missing_params')

  // Sanity-check the org id from state actually exists before storing tokens.
  const { data: org } = await supabaseAdmin
    .from('orgs')
    .select('id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return back('qb=error&reason=bad_state')

  try {
    await exchangeCodeForTokens(code, realmId, orgId)
    return back('qb=connected')
  } catch (err: any) {
    return back(`qb=error&reason=${encodeURIComponent(err?.message || 'exchange_failed')}`)
  }
}
