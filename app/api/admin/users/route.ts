import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSeatStatus } from '@/lib/seats'

// ============================================================================
// /api/admin/users — login + role management (chunk A2, roles added item 5)
// ============================================================================
// The one explicit bridge between a team roster entry (orgs.team_members
// jsonb) and a real login. Creating a login materializes a Supabase auth
// user + a public `users` row; the caller (/team) then writes the returned
// user_id back onto team_members[member].user_id.
//
// Roles (the model RoleGate enforces, unchanged — this route only ASSIGNS):
//   owner  — everything, including /settings where compensation lives.
//   admin  — "Manager": everything except /settings.
//   member — "Worker": the /me time app only.
//
// Authority rules, enforced here because the client can't be trusted:
//   • Only the OWNER may create or promote a manager (admin). An admin can
//     create workers and manage workers, nothing more — otherwise any admin
//     could mint themselves peers, or reset a peer's password and take the
//     account over.
//   • Nobody may change their own role (no self-promotion, no accidental
//     self-demotion locking the org out).
//   • The owner row is untouchable: not demotable, not resettable by an
//     admin, never unlinkable.
// ============================================================================

type Role = 'owner' | 'admin' | 'member'
type Caller = { orgId: string; callerId: string; callerRole: Role }
type Guard = Caller | { error: NextResponse }

const forbidden = (message: string) =>
  NextResponse.json({ error: 'Forbidden', message }, { status: 403 })

async function requireOwnerOrAdmin(req: NextRequest): Promise<Guard> {
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
    .select('id, org_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return {
    orgId: caller.org_id,
    callerId: caller.id,
    callerRole: caller.role as Role,
  }
}

// Resolve a public users row that must belong to the caller's org, so
// reset/unlink/set_role can never reach across orgs.
async function resolveOrgUser(userId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, org_id, auth_user_id, role, name, email')
    .eq('id', userId)
    .single()
  if (!data || data.org_id !== orgId) return null
  return data as {
    id: string
    org_id: string
    auth_user_id: string | null
    role: Role
    name: string | null
    email: string | null
  }
}

/** Shared authority check for acting ON another account (reset / unlink /
 *  set_role). Returns an error response, or null when the action is allowed. */
function checkAuthorityOver(
  caller: Caller,
  target: { id: string; role: Role },
): NextResponse | null {
  if (target.role === 'owner') {
    return forbidden("The owner's account can't be changed here.")
  }
  if (caller.callerRole !== 'owner' && target.role !== 'member') {
    return forbidden('Only the owner can manage manager accounts.')
  }
  return null
}

export async function POST(req: NextRequest) {
  const guard = await requireOwnerOrAdmin(req)
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
    // Item 5: a login can be created straight as a manager, so the owner
    // doesn't have to create-then-promote. Anything other than an explicit
    // 'admin' is a worker.
    const role: Role = body.role === 'admin' ? 'admin' : 'member'
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    if (role === 'admin' && guard.callerRole !== 'owner') {
      return forbidden('Only the owner can create a manager login.')
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
        role,
        // Neither workers nor managers run the owner onboarding
        // (shop-rate/base-cabinet) walkthrough, so mark them onboarded up
        // front — the WelcomeOverlay also role-gates, this keeps the data
        // honest for any other reader.
        onboarded_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (insertErr || !userRow) {
      // Roll back the orphaned auth user so a retry can reuse the email.
      await supabaseAdmin.auth.admin.deleteUser(created.user.id)
      return NextResponse.json({ error: 'Could not link the login' }, { status: 500 })
    }

    return NextResponse.json({ user_id: userRow.id, auth_user_id: created.user.id, email, role })
  }

  // ── Change a login's role (item 5) ──
  // Owner-only, and never on yourself or the owner. RoleGate does the routing;
  // this is purely assignment.
  if (action === 'set_role') {
    const userId = String(body.user_id || '')
    const nextRole = String(body.role || '')
    if (nextRole !== 'admin' && nextRole !== 'member') {
      return NextResponse.json(
        { error: 'Role must be "admin" (manager) or "member" (worker)' },
        { status: 400 },
      )
    }
    if (guard.callerRole !== 'owner') {
      return forbidden('Only the owner can change roles.')
    }
    if (userId === guard.callerId) {
      return forbidden("You can't change your own role.")
    }
    const target = await resolveOrgUser(userId, orgId)
    if (!target) {
      return NextResponse.json({ error: 'Login not found' }, { status: 404 })
    }
    const denied = checkAuthorityOver(guard, target)
    if (denied) return denied
    if (target.role === nextRole) return NextResponse.json({ success: true, role: nextRole })

    const { error: roleErr } = await supabaseAdmin
      .from('users')
      .update({ role: nextRole })
      .eq('id', target.id)
      .eq('org_id', orgId)
    if (roleErr) {
      return NextResponse.json({ error: roleErr.message }, { status: 400 })
    }
    return NextResponse.json({ success: true, role: nextRole })
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
    // Resetting someone's password IS taking their account over, so it needs
    // the same authority as changing their role: an admin can only do it to a
    // worker, and nobody can do it to the owner. (The owner resets their own
    // password through normal auth, not this route.)
    const denied = checkAuthorityOver(guard, target)
    if (denied) return denied
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
    const denied = checkAuthorityOver(guard, target)
    if (denied) return denied
    if (target.id === guard.callerId) {
      return forbidden("You can't remove your own login.")
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
