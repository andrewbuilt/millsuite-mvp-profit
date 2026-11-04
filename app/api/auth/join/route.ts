import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSeatStatus } from '@/lib/seats'
import {
  findLoginConflict,
  joinConflictMessage,
  normEmail,
  rosterMatchForJoin,
  type LoginRow,
  type RosterRow,
} from '@/lib/login-dupes'

// Called when a team member signs up via /join/[slug] — adds them to an
// existing org. PR #115 hard-gates this on seat availability: if the
// org is at its seat limit, the join fails with a 402 (Payment Required)
// and the front-end /join/[slug] page surfaces a "ask the owner to add
// seats" message. Owners add seats via Settings → Subscription →
// Manage subscription → Customer Portal.
//
// ⛔ ONE PERSON, ONE LOGIN (2026-11-06 root fix). This route minted Kaylin's
// gmail member login and Evan's "Evan_o": anyone with the link, any email,
// landed as a worker linked to NO roster row — a second login for someone who
// already had one, and /me, "Mine" and RoleGate all went wrong for them.
// Now:
//   · { precheck: true } runs the checks BEFORE the page creates the auth
//     account, so a refused join leaves nothing behind.
//   · The join itself re-checks (lib/login-dupes) and refuses when the roster
//     says this person already has a login — the message points them at it.
//   · An email that matches an unlinked roster row LINKS to it, so the new
//     login belongs to someone from the first second.
//   · The auth account is verified server-side (it must exist and carry this
//     email) instead of trusting the id in the body. A refused join deletes
//     the auth account it just created — only one with no users row, made in
//     the last 15 minutes.

async function loadOrg(slug: string) {
  const { data } = await supabaseAdmin.from('orgs').select('id, name, team_members').eq('slug', slug).single()
  return data as { id: string; name: string; team_members: RosterRow[] | null } | null
}

async function conflictFor(orgId: string, roster: RosterRow[], email: string, name: string) {
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, org_id, name, email, role, auth_user_id')
    .eq('org_id', orgId)
  return findLoginConflict({ email, name }, (users || []) as LoginRow[], roster)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = normEmail(body.email)
    const name = String(body.name || '').trim()
    const slug = String(body.slug || '')
    if (!email || !name || !slug) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const org = await loadOrg(slug)
    if (!org) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })
    const roster = (org.team_members || []).filter(Boolean)

    // ── PRECHECK: before any account exists ──
    if (body.precheck === true) {
      const conflict = await conflictFor(org.id, roster, email, name)
      if (conflict) {
        return NextResponse.json({ error: 'already_has_login', message: joinConflictMessage(conflict, org.name) }, { status: 409 })
      }
      const seatStatus = await getSeatStatus(org.id)
      if (seatStatus.atLimit) {
        return NextResponse.json(
          {
            error: 'no_seats_available',
            message: `${org.name} has used all ${seatStatus.limit} of its seats. Ask the shop owner to add more seats from Settings → Subscription before joining.`,
            used: seatStatus.used,
            limit: seatStatus.limit,
          },
          { status: 402 },
        )
      }
      return NextResponse.json({ ok: true })
    }

    const authUserId = String(body.auth_user_id || '')
    if (!authUserId) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

    // The auth account must exist and carry this email — the id in the body
    // is not proof of anything on its own.
    const { data: authRes } = await supabaseAdmin.auth.admin.getUserById(authUserId)
    const authUser = authRes?.user
    if (!authUser || normEmail(authUser.email) !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Already joined (a retry): return the row.
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, org_id')
      .eq('auth_user_id', authUserId)
      .single()
    if (existingUser) {
      return NextResponse.json({ org_id: existingUser.org_id, user_id: existingUser.id })
    }

    /** Undo the auth account this join just created (it has no users row). */
    const discardFreshAuth = async () => {
      const ageMs = Date.now() - new Date(authUser.created_at).getTime()
      if (ageMs < 15 * 60 * 1000) await supabaseAdmin.auth.admin.deleteUser(authUserId)
    }

    const conflict = await conflictFor(org.id, roster, email, name)
    if (conflict) {
      await discardFreshAuth()
      return NextResponse.json({ error: 'already_has_login', message: joinConflictMessage(conflict, org.name) }, { status: 409 })
    }

    // Seat enforcement (PR #115).
    const seatStatus = await getSeatStatus(org.id)
    if (seatStatus.atLimit) {
      await discardFreshAuth()
      return NextResponse.json(
        {
          error: 'no_seats_available',
          message: `${org.name} has used all ${seatStatus.limit} of its seats. Ask the shop owner to add more seats from Settings → Subscription before joining.`,
          used: seatStatus.used,
          limit: seatStatus.limit,
        },
        { status: 402 },
      )
    }

    const match = rosterMatchForJoin(email, roster)

    // Create user linked to this org as a member
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        org_id: org.id,
        auth_user_id: authUserId,
        email,
        name: match?.name || name,
        role: 'member',
        // Someone joining an existing shop has nothing to set up — the
        // walkthrough configures the SHOP and belongs to the owner. Stamped
        // here so the column tells the truth for any reader, not just because
        // WelcomeOverlay is owner-gated.
        onboarded_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (userError) {
      console.error('User creation error:', userError)
      await discardFreshAuth()
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    }

    // The roster row with this email and no login yet → link it now (a fresh
    // read, touching only that row's user_id).
    if (match) {
      const { data: fresh } = await supabaseAdmin.from('orgs').select('team_members').eq('id', org.id).single()
      const team = ((fresh?.team_members as RosterRow[] | null) || []).map((m) =>
        m.id === match.id && !m.user_id ? { ...m, user_id: user.id } : m,
      )
      const { error: linkErr } = await supabaseAdmin.from('orgs').update({ team_members: team }).eq('id', org.id)
      if (linkErr) console.error('Join: roster link failed (login created, link it on /team):', linkErr)
    }

    return NextResponse.json({
      org_id: org.id,
      user_id: user.id,
      org_name: org.name,
      linked_member: match?.name ?? null,
    })
  } catch (err: any) {
    console.error('Join error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
