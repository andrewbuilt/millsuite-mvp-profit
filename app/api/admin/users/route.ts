import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSeatStatus } from '@/lib/seats'
import { conflictMessage, findLoginConflict, type LoginRow, type RosterRow } from '@/lib/login-dupes'

/** This org's logins + roster, for the one-person-one-login checks. */
async function loadLoginsAndRoster(orgId: string): Promise<{ logins: LoginRow[]; roster: RosterRow[] }> {
  const [{ data: users }, { data: org }] = await Promise.all([
    supabaseAdmin.from('users').select('id, org_id, name, email, role, auth_user_id').eq('org_id', orgId),
    supabaseAdmin.from('orgs').select('team_members').eq('id', orgId).single(),
  ])
  return {
    logins: (users || []) as LoginRow[],
    roster: ((org?.team_members as RosterRow[] | null) || []).filter(Boolean),
  }
}

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
    .select('id, org_id, auth_user_id, role, name, email, onboarded_at')
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
    onboarded_at: string | null
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

    // ⛔ ONE PERSON, ONE LOGIN (2026-11-06 root fix — Andrew, Kaylin, Evan).
    // Refuse BEFORE minting anything when this person already has a login,
    // the email is taken, or an unlinked login looks like them; the message
    // names the login that exists and what to do instead (Link existing /
    // Reset password). lib/login-dupes holds the rules.
    {
      const { logins, roster } = await loadLoginsAndRoster(orgId)
      const memberId = typeof body.member_id === 'string' ? body.member_id : null
      const conflict = findLoginConflict({ email, name, memberId }, logins, roster)
      if (conflict) {
        return NextResponse.json(
          { error: 'login_exists', kind: conflict.kind, message: conflictMessage(conflict, name || email), login_id: conflict.login.id },
          { status: 409 },
        )
      }
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
      // The email has an auth account elsewhere (another shop, or a signup
      // that never finished). Say so plainly — never "try another email",
      // which is how a person ends up with two.
      const taken = /already|registered|exists/i.test(createErr?.message || '')
      return NextResponse.json(
        {
          error: taken ? 'login_exists' : createErr?.message || 'Could not create the login',
          message: taken
            ? 'That email already has a MillSuite account (another shop, or an unfinished signup). Use Link existing if it is in this shop — otherwise ask us to move it rather than creating a second account with a different email.'
            : createErr?.message || 'Could not create the login',
        },
        { status: taken ? 409 : 400 },
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
      .update({
        role: nextRole,
        // Stamp onboarding shut on the way through. The setup walkthrough is
        // the owner's job, and nobody promoted into an existing shop should
        // ever meet it. WelcomeOverlay is already owner-only, so this is the
        // second lock — it also keeps the column honest for any other reader.
        // COALESCE-style: only set it if it was never set, so a real first
        // onboarding date isn't overwritten.
        ...(target.onboarded_at ? {} : { onboarded_at: new Date().toISOString() }),
      })
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

  // ── Disable / re-enable a login (Nov batch 2, team lifecycle) ──
  //
  // ⛔ DEACTIVATE, DON'T DELETE. A deactivated member's history (time,
  // tasks, reviews) is attributed through users.id ↔ roster user_id, so the
  // login row has to survive. This bans the AUTH user (can't sign in) and
  // leaves users + the roster link alone; re-enabling lifts the ban.
  if (action === 'set_login_disabled') {
    const userId = String(body.user_id || '')
    const disabled = body.disabled === true
    const target = await resolveOrgUser(userId, orgId)
    if (!target?.auth_user_id) {
      return NextResponse.json({ error: 'Login not found' }, { status: 404 })
    }
    const denied = checkAuthorityOver(guard, target)
    if (denied) return denied
    if (target.id === guard.callerId) {
      return forbidden("You can't disable your own login.")
    }
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(target.auth_user_id, {
      // ~100 years; 'none' lifts it.
      ban_duration: disabled ? '876000h' : 'none',
    })
    if (banErr) {
      return NextResponse.json({ error: banErr.message }, { status: 400 })
    }
    return NextResponse.json({ success: true, disabled })
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

  // ── Linking an EXISTING login to a roster row ────────────────────────────
  //
  // ⛔ WHY THIS EXISTS. Every other action here CREATES a login. There was no
  // way to point a roster row at a login that already existed — which left the
  // single most common case unreachable: the OWNER. They sign up first, build
  // the roster afterwards, and the two are never connected. Andrew hit it on
  // /pm ("its bringing in tasks for everyone, not just me") because
  // `myAssigneeId` resolves login → roster row and his was null, so nothing
  // could ever be "his" anywhere in the task system.
  //
  // create_login couldn't fix it either: it mints a NEW auth user, and its
  // role argument is admin|member, so using it on the owner's own row would
  // have produced a second, weaker account.

  if (action === 'list_logins') {
    // Candidates for linking. The browser CANNOT read this itself —
    // `users_select_self` (084) limits it to its own row — which is exactly
    // why the picker has to come from the service role.
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role')
      .eq('org_id', orgId)
      .order('name')
    if (error) {
      return NextResponse.json({ error: 'Could not load logins' }, { status: 500 })
    }
    return NextResponse.json({ logins: data || [] })
  }

  if (action === 'link_login') {
    const userId = String(body.user_id || '')
    const target = await resolveOrgUser(userId, orgId)
    if (!target) {
      return NextResponse.json({ error: 'Login not found' }, { status: 404 })
    }
    // ⛔ NO AUTHORITY CHECK BEYOND ORG MEMBERSHIP, DELIBERATELY, AND IT IS SAFE:
    // linking grants NOTHING. It writes team_members[].user_id, which decides
    // whose name a task shows under — it does not touch roles, passwords or
    // access. `checkAuthorityOver` guards privilege changes; borrowing it here
    // would block an admin from linking the owner, which is the main case.
    // The caller is already owner-or-admin in this org (requireOwnerOrAdmin),
    // and resolveOrgUser pins the target to the SAME org.
    //
    // ⛔ But one login, one roster row: linking a login another person's row
    // already holds would make two people share it (2026-11-06).
    {
      const memberId = typeof body.member_id === 'string' ? body.member_id : null
      const { roster } = await loadLoginsAndRoster(orgId)
      const holder = roster.find((m) => m.user_id === target.id && m.id !== memberId)
      if (holder) {
        return NextResponse.json(
          { error: 'login_linked', message: `That login is already linked to ${holder.name}. Unlink it there first — one login per person.` },
          { status: 409 },
        )
      }
    }
    return NextResponse.json({
      user_id: target.id,
      email: target.email ?? null,
      role: target.role ?? null,
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
