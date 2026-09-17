// ============================================================================
// POST /api/portal/{token}/delivery-address — client write #3
// ============================================================================
// The client tells the shop where the work is going. Same shape as the other
// two portal writes: token re-proved server-side, nothing taken from the
// request except the project id and the one field this route exists to set.
//
// ⛔ FILL-ONLY, NEVER OVERWRITE. The portal may set delivery_address only when
// the project doesn't have one. If the shop recorded an address, a stale portal
// tab (or a hostile replay) must not replace it — the re-asserted emptiness in
// the UPDATE's WHERE makes that atomic, and a zero-row result reads as a
// conflict, not success (the .select() rule from the approve route).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { authorizePortalProject } from '@/lib/client-portal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** One line on a project header, not a shipping manifest. */
const MAX_ADDRESS_LENGTH = 200

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const body = (await req.json().catch(() => null)) as { projectId?: string; address?: string } | null
  const projectId = String(body?.projectId || '')
  // Collapse whitespace the same way the sign route treats the name: what gets
  // stored is a display string, not the client's raw keystrokes.
  const address = String(body?.address || '').trim().replace(/\s+/g, ' ').slice(0, MAX_ADDRESS_LENGTH)
  if (!projectId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  if (address.length < 5) {
    return NextResponse.json({ error: 'Please enter the full delivery address' }, { status: 400 })
  }

  const auth = await authorizePortalProject(token, projectId)
  // One shape for "no such token", "not your project" and "no such project".
  if (!auth) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Read what's there so '' and NULL can both count as "none" — the app has
  // only ever written NULL, but an empty string must not brick this route.
  const { data: projRow } = await supabaseAdmin
    .from('projects')
    .select('id, delivery_address')
    .eq('id', projectId)
    .maybeSingle()
  const current = (projRow as { id: string; delivery_address: string | null } | null)?.delivery_address ?? null
  if (current && current.trim().length > 0) {
    return NextResponse.json({ error: 'An address is already on file' }, { status: 409 })
  }

  // Re-assert emptiness in the WHERE so two tabs racing can't overwrite each
  // other; .select() back so a zero-row update can't read as success.
  let query = supabaseAdmin
    .from('projects')
    .update({ delivery_address: address, updated_at: new Date().toISOString() })
    .eq('id', projectId)
  query = current === null ? query.is('delivery_address', null) : query.eq('delivery_address', current)
  const { data: updated, error } = await query.select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'An address is already on file' }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}
