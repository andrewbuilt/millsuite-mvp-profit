// ============================================================================
// POST /api/portal/{token}/approve — client write #1
// ============================================================================
// The client approves one selection. Authenticated by the portal token alone,
// so every check is done here and nothing is taken from the request except the
// two ids, both of which are re-proved against the token's client.
//
// ⛔ WHY THIS DOESN'T CALL lib/approvals.approve()
// That helper runs on the BROWSER supabase client, which in a route handler has
// no session and would be refused by RLS — silently, since PostgREST returns a
// zero-row success. So the transition is re-implemented here on the service
// role, and it must stay behaviourally identical to applyTransition():
//   1. flip state + ball_in_court + last_state_change_at
//   2. write the item_revisions audit row  ← easy to forget, load-bearing
//   3. propagate both to any slot linked TO this one
// If lib/approvals.applyTransition grows a fourth step, it has to be mirrored
// here or portal approvals will quietly diverge from in-app ones.
//
// It deliberately does NOT run finalizeSpecCosOnApproval — see the guard below.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { authorizePortalProject, draftCoItemIds } from '@/lib/client-portal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const body = (await req.json().catch(() => null)) as { projectId?: string; itemId?: string } | null
  const projectId = String(body?.projectId || '')
  const itemId = String(body?.itemId || '')
  if (!projectId || !itemId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const auth = await authorizePortalProject(token, projectId)
  // One shape for "no such token", "not your project" and "no such project":
  // a stranger must not be able to tell them apart.
  if (!auth) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The item must hang off a subproject of THIS project. Without this, a valid
  // token plus a guessed item id would approve something on another job.
  const { data: subs } = await supabaseAdmin.from('subprojects').select('id').eq('project_id', projectId)
  const subIds = ((subs as { id: string }[] | null) || []).map((s) => s.id)
  if (subIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: itemRow } = await supabaseAdmin
    .from('approval_items')
    .select('id, state, ball_in_court, subproject_id')
    .eq('id', itemId)
    .in('subproject_id', subIds)
    .maybeSingle()
  const item = itemRow as { id: string; state: string; ball_in_court: string | null } | null
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Already done — idempotent, so a double-tap or a retried request is a no-op
  // rather than a second audit row.
  if (item.state === 'approved') return NextResponse.json({ ok: true, alreadyApproved: true })

  // The ball has to actually be with the client. If the shop has pulled it back
  // (new sample round, material swap), a stale portal tab must not re-approve.
  if (item.ball_in_court !== 'client') {
    return NextResponse.json({ error: 'Not yours to approve right now' }, { status: 409 })
  }

  // ⛔ Priced-change guard. Approving an item that carries a draft change order
  // is, in the app, also an approval of that CO's price. The client hasn't been
  // shown a number here, so refuse and make the shop send a real change order.
  if ((await draftCoItemIds([itemId])).has(itemId)) {
    return NextResponse.json({ error: 'A change order is needed for this first' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const patch = { state: 'approved', ball_in_court: null, last_state_change_at: now, updated_at: now }

  // .select() back so a zero-row update can't read as success — the same
  // success-shaped-silence trap the top of STATE.md documents.
  const { data: updated, error } = await supabaseAdmin
    .from('approval_items')
    .update(patch)
    .eq('id', itemId)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Nothing was updated' }, { status: 500 })
  }

  // Audit row. Matches applyTransition's shape; actor is null because the
  // signer is a client, who has no users row by design.
  await supabaseAdmin.from('item_revisions').insert({
    approval_item_id: itemId,
    action: 'approved',
    note: 'Approved by client in the portal',
    actor_user_id: null,
    occurred_at: now,
  })

  // Linked slots: one approval covers both, so mirror to anything pointing at
  // this item — same rule as the in-app path.
  const { data: deps } = await supabaseAdmin.from('approval_items').select('id').eq('linked_to_item_id', itemId)
  for (const dep of ((deps as { id: string }[] | null) || [])) {
    await supabaseAdmin.from('approval_items').update(patch).eq('id', dep.id)
    await supabaseAdmin.from('item_revisions').insert({
      approval_item_id: dep.id,
      action: 'approved',
      note: `(auto) linked to ${itemId}`,
      actor_user_id: null,
      occurred_at: now,
    })
  }

  return NextResponse.json({ ok: true })
}
