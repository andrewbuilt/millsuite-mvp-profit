import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSeatStatus } from '@/lib/seats'

// ============================================================================
// /api/admin/users — worker login management (chunk A2)
// ============================================================================
// The one explicit bridge between a team roster entry (orgs.team_members
// jsonb) and a real login. Creating a login materializes a Supabase auth
// user + a public `users` row (role='member'); the caller (/team) then
// writes the returned user_id back onto team_members[member].user_id.
//
// Every action is owner/admin-only and scoped to the caller's org. We
// verify the Bearer access token via the service-role client, resolve the
// caller's users row, and check role before touching anything.
// ============================================================================

type Guard = { orgId: string } | { error: NextResponse }

async function requireOwner(req: NextRequest): Promise<Guard> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const { data: caller } = await supabaseAdmin
    .from('users')
    .select('org_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { orgId: caller.org_id }
}

// Resolve a public users row that must belong to the caller's org, so
// reset/unlink can never reach across orgs.
async function resolveOrgUser(userId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, org_id, auth_user_id')
    .eq('id', userId)
    .single()
  if (!data || data.org_id !== orgId) return null
  return data
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner(req)
  if ('error' in guard) return guard.error
  const { orgId } = guard

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = String(body.action || '')

  // ── Create a login for a roster member ──
  if (action === 'create_login') {
    const email = String(body.email || '').trim().toLowerCase()
    const name = String(body.name || '').trim()
    const password = String(body.password || '')
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // A worker login consumes a seat, so honor the same limit as /join.
    const seatStatus = await getSeatStatus(orgId)
    if (seatStatus.atLimit) {
      return NextResponse.json(
        {
          error: 'no_seats_available',
          message: `You've used all ${seatStatus.limit} seats. Add more from Settings → Subscription before creating another login.`,
        },
        { status: 402 },
      )
    }

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr || !created?.user) {
      return NextResponse.json(
        { error: createErr?.message || 'Could not create the login (is the email already in use?)' },
        { status: 400 },
      )
    }

    const { data: userRow, error: insertErr } = await supabaseAdmin
      .from('users')
      .insert({
        org_id: orgId,
        auth_user_id: created.user.id,
        email,
        name: name || email,
        role: 'member',
        // Workers never run the owner onboarding (shop-rate/base-cabinet)
        // walkthrough, so mark them onboarded up front — the WelcomeOverlay
        // also role-gates, this keeps the data honest for any other reader.
        onboarded_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (insertErr || !userRow) {
      // Roll back the orphaned auth user so a retry can reuse the email.
      await supabaseAdmin.auth.admin.deleteUser(created.user.id)
      return NextResponse.json({ error: 'Could not link the login' }, { status: 500 })
    }

    return NextResponse.json({ user_id: userRow.id, auth_user_id: created.user.id, email })
  }

  // ── Reset a member's password ──
  if (action === 'reset_password') {
    const userId = String(body.user_id || '')
    const password = String(body.password || '')
    if (!userId || password.length < 8) {
      return NextResponse.json({ error: 'A password of at least 8 characters is required' }, { status: 400 })
    }
    const target = await resolveOrgUser(userId, orgId)
    if (!target?.auth_user_id) {
      return NextResponse.json({ error: 'Login not found' }, { status: 404 })
    }
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(target.auth_user_id, {
      password,
    })
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  }

  // ── Remove (unlink) a member's login ──
  if (action === 'unlink') {
    const userId = String(body.user_id || '')
    const target = await resolveOrgUser(userId, orgId)
    if (!target) {
      return NextResponse.json({ error: 'Login not found' }, { status: 404 })
    }
    if (target.auth_user_id) {
      await supabaseAdmin.auth.admin.deleteUser(target.auth_user_id)
    }
    // Drop any legacy dept-member rows keyed off this user, then the row.
    await supabaseAdmin.from('department_members').delete().eq('user_id', target.id)
    await supabaseAdmin.from('users').delete().eq('id', target.id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
