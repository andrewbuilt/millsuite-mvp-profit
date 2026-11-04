// ============================================================================
// lib/login-dupes.ts — one person, one login (STATE 2026-11-06 root fix)
// ============================================================================
// THREE PEOPLE, THREE DIFFERENT BREAKAGES, ONE SHAPE:
//   Andrew 09-12  his row linked to a second admin account → "Mine" meant everyone
//   Kaylin 10-16  a gmail MEMBER login linked to no roster row → /me disowned her
//   Evan   11-03  "Evan_o", a MEMBER login linked to no roster row, created
//                 the same day as his real admin login → RoleGate'd to /me,
//                 couldn't approve PTO or open /engineering
//
// The second login always came from a path that MINTS one without asking
// whether this person already has one: /join/[slug] (anyone with the link,
// any email, lands as an unlinked worker) and /team "Create login" (never
// looked). Both now ask THIS module first and REFUSE with a pointer to the
// login that exists ("sign in with it" / "Link existing"), instead of
// silently making a second.
//
// The same rules power scripts/inspect-logins.mjs, the standing diagnostic.
// Pure — no database.
// ============================================================================

export interface LoginRow {
  id: string
  org_id: string
  name: string | null
  email: string | null
  role: string | null
  auth_user_id: string | null
}

export interface RosterRow {
  id: string
  name: string
  email?: string | null
  user_id?: string | null
  active?: boolean
}

/** "Evan_o" → "evan o", "  Kaylin  PRICE " → "kaylin price". */
export function normName(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

export function normEmail(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase()
}

/**
 * Do two names plausibly mean the same person? Same first name AND the
 * rest agrees as far as both go: "Evan_o" ~ "Evan Otero" (o is a prefix of
 * otero), "evan" ~ "Evan Otero", "kaylinprice23" ~ "Kaylin Price" (joined
 * letters equal). "Evan Smith" ≁ "Evan Otero". An email's local part works
 * as a name too.
 */
export function namesLookAlike(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normName(a)
  const y = normName(b)
  if (!x || !y) return false
  if (x === y) return true
  if (x.replace(/ /g, '') === y.replace(/ /g, '')) return true
  const [xf, ...xr] = x.split(' ')
  const [yf, ...yr] = y.split(' ')
  if (xf !== yf || xf.length < 2) return false
  const xl = xr.join('')
  const yl = yr.join('')
  if (!xl || !yl) return true
  return xl.startsWith(yl) || yl.startsWith(xl)
}

/** "evan.otero@builtthings.com" → "•••@builtthings.com". /join is a PUBLIC
 *  page: the domain is enough to recognise which account, and nothing of the
 *  person's address is harvestable from it. */
export function maskEmail(e: string | null | undefined): string {
  const s = normEmail(e)
  const at = s.indexOf('@')
  if (at < 0) return s ? '•••' : ''
  return `•••${s.slice(at)}`
}

export type Conflict =
  /** The roster row being given a login already has one. */
  | { kind: 'member_has_login'; login: LoginRow }
  /** A login with this email already exists (this org). */
  | { kind: 'email_taken'; login: LoginRow; linkedTo: RosterRow | null }
  /** A roster person who already HAS a login looks like this one. */
  | { kind: 'person_has_login'; login: LoginRow; member: RosterRow }
  /** An unlinked login in this org looks like this person — link it instead. */
  | { kind: 'unlinked_lookalike'; login: LoginRow }

/**
 * Would creating a login for { email, name } — optionally for roster row
 * `memberId` — make a SECOND login for someone who has one? Returns the
 * first reason it would, or null. Callers: /team create_login (memberId
 * set) and /join (no memberId; the joiner is matched by email / name).
 */
export function findLoginConflict(
  want: { email: string; name: string; memberId?: string | null },
  logins: LoginRow[],
  roster: RosterRow[],
): Conflict | null {
  const email = normEmail(want.email)
  const byId = new Map(logins.map((l) => [l.id, l]))
  const linkedIds = new Set(roster.map((m) => m.user_id).filter(Boolean) as string[])
  const member = want.memberId ? roster.find((m) => m.id === want.memberId) || null : null

  if (member?.user_id && byId.has(member.user_id)) {
    return { kind: 'member_has_login', login: byId.get(member.user_id)! }
  }

  const sameEmail = email ? logins.find((l) => normEmail(l.email) === email) : undefined
  if (sameEmail) {
    return { kind: 'email_taken', login: sameEmail, linkedTo: roster.find((m) => m.user_id === sameEmail.id) || null }
  }

  // The person, as the roster knows them: the row being set up, or (on /join)
  // the roster row whose email or name matches the joiner.
  const name = member?.name || want.name
  const candidates = member
    ? [member]
    : roster.filter((m) => (email && normEmail(m.email) === email) || namesLookAlike(m.name, name) || namesLookAlike(m.name, email.split('@')[0]))
  for (const m of candidates) {
    if (m.id === member?.id) continue
    if (m.user_id && byId.has(m.user_id)) return { kind: 'person_has_login', login: byId.get(m.user_id)!, member: m }
  }

  // An orphan login (linked to no roster row) that looks like this person —
  // Evan_o's exact shape. Link it rather than mint a third.
  const orphan = logins.find(
    (l) =>
      !linkedIds.has(l.id) &&
      l.role !== 'owner' &&
      (namesLookAlike(l.name, name) || namesLookAlike(normEmail(l.email).split('@')[0], name)),
  )
  if (orphan) return { kind: 'unlinked_lookalike', login: orphan }
  return null
}

/** The roster row a /join should link to automatically: the one whose
 *  email matches and has no login yet. */
export function rosterMatchForJoin(email: string, roster: RosterRow[]): RosterRow | null {
  const e = normEmail(email)
  if (!e) return null
  return roster.find((m) => normEmail(m.email) === e && !m.user_id && m.active !== false) || null
}

/** The /team message for a conflict — always says what to do instead. */
export function conflictMessage(c: Conflict, forName: string): string {
  const who = (l: LoginRow) => `${l.name || 'a login'} (${l.email || 'no email'}, ${l.role === 'admin' ? 'manager' : l.role === 'owner' ? 'owner' : 'worker'})`
  switch (c.kind) {
    case 'member_has_login':
      return `${forName} already has a login: ${who(c.login)}. Use Reset password or Change login instead of making a second one.`
    case 'email_taken':
      return c.linkedTo
        ? `That email already belongs to ${who(c.login)}, linked to ${c.linkedTo.name}. One person, one login.`
        : `A login with that email already exists: ${who(c.login)}. Use Link existing to attach it to ${forName}.`
    case 'person_has_login':
      return `${c.member.name} already has a login: ${who(c.login)}. Sign in with it (Reset password if it's forgotten) rather than creating another.`
    case 'unlinked_lookalike':
      return `There's already a login that looks like ${forName} and isn't linked to anyone: ${who(c.login)}. Use Link existing to attach it, or remove it on /team first.`
  }
}

/** The /join message — public page, so emails are masked. */
export function joinConflictMessage(c: Conflict, orgName: string): string {
  const l = c.login
  return `It looks like you already have a login at ${orgName} (${maskEmail(l.email)}). Sign in with that one at /login — if you've forgotten the password, your manager can reset it from the Team page. Ask them before creating a second account.`
}

// ── The standing diagnostic (scripts/inspect-logins.mjs) ─────────────────

export interface AuthAccount {
  id: string
  email: string | null
  banned: boolean
  lastSignIn: string | null
}

export interface LoginIssue {
  org: string
  kind:
    | 'no_auth_account'
    | 'dead_auth_account'
    | 'duplicate_email'
    | 'duplicate_person'
    | 'unlinked_login'
    | 'roster_points_at_missing'
    | 'roster_points_at_disabled'
    | 'roster_points_cross_org'
    | 'two_rows_one_login'
    | 'manager_signs_in_as_worker'
    | 'auth_without_profile'
  who: string
  detail: string
}

/**
 * Every mismatch, for one org. Pure: the caller loads users, the roster and
 * the auth accounts. `allLogins` spans every org (for the cross-org and
 * same-email checks).
 */
export function loginIssues(
  org: { id: string; name: string; roster: RosterRow[] },
  allLogins: LoginRow[],
  auth: Map<string, AuthAccount>,
): LoginIssue[] {
  const out: LoginIssue[] = []
  const mine = allLogins.filter((l) => l.org_id === org.id)
  const byId = new Map(allLogins.map((l) => [l.id, l]))
  const roster = org.roster.filter((m) => m.active !== false)
  const linked = new Map<string, RosterRow[]>()
  for (const m of org.roster) if (m.user_id) linked.set(m.user_id, [...(linked.get(m.user_id) || []), m])
  const push = (kind: LoginIssue['kind'], who: string, detail: string) => out.push({ org: org.name, kind, who, detail })
  const label = (l: LoginRow) => `${l.name || '(no name)'} <${l.email || 'no email'}> ${l.role}`

  for (const l of mine) {
    if (!l.auth_user_id) push('no_auth_account', label(l), 'users row with no auth_user_id — nobody can sign in to it')
    else if (!auth.has(l.auth_user_id)) push('dead_auth_account', label(l), `auth_user_id ${l.auth_user_id.slice(0, 8)} matches no live auth account`)
    const twins = allLogins.filter((o) => o.id !== l.id && normEmail(o.email) && normEmail(o.email) === normEmail(l.email))
    if (twins.length && l.id < twins[0].id) push('duplicate_email', label(l), `same email as ${twins.map(label).join(', ')}`)
    if (!linked.has(l.id) && l.role !== 'owner') {
      const twin = roster.find((m) => m.user_id && m.user_id !== l.id && (namesLookAlike(m.name, l.name) || namesLookAlike(m.name, normEmail(l.email).split('@')[0])))
      if (twin) {
        const real = byId.get(twin.user_id!)
        const kind = real && (real.role === 'admin' || real.role === 'owner') && l.role === 'member' ? 'manager_signs_in_as_worker' : 'duplicate_person'
        const a = l.auth_user_id ? auth.get(l.auth_user_id) : null
        const b = real?.auth_user_id ? auth.get(real.auth_user_id) : null
        push(kind, label(l), `looks like ${twin.name}, whose linked login is ${real ? label(real) : twin.user_id}. Last sign-in: this ${a?.lastSignIn?.slice(0, 10) || 'never'} vs linked ${b?.lastSignIn?.slice(0, 10) || 'never'}`)
      } else {
        // Is there a roster row waiting for this person? (same email, or a
        // name that looks alike, and no login of its own) → Link existing.
        const waiting = roster.find(
          (m) => !m.user_id && ((normEmail(m.email) && normEmail(m.email) === normEmail(l.email)) || namesLookAlike(m.name, l.name)),
        )
        push(
          'unlinked_login',
          label(l),
          waiting
            ? `linked to no roster row — the roster has an unlinked "${waiting.name}": /team → ${waiting.name} → Link existing`
            : 'linked to no roster row, and no roster row matches — add them on /team and Link existing, or disable it',
        )
      }
    }
  }

  for (const m of org.roster) {
    if (!m.user_id) continue
    const l = byId.get(m.user_id)
    if (!l) push('roster_points_at_missing', m.name, `roster user_id ${m.user_id.slice(0, 8)} matches no users row`)
    else if (l.org_id !== org.id) push('roster_points_cross_org', m.name, `linked to ${label(l)} in ANOTHER org`)
    else if (m.active !== false && l.auth_user_id && auth.get(l.auth_user_id)?.banned) push('roster_points_at_disabled', m.name, `active on the roster but the login ${label(l)} is disabled`)
  }
  for (const [uid, rows] of linked) {
    if (rows.length > 1) push('two_rows_one_login', rows.map((r) => r.name).join(' + '), `both roster rows link to ${byId.get(uid) ? label(byId.get(uid)!) : uid}`)
  }
  return out
}

/** Auth accounts with no users row anywhere — usually a /join that failed half-way. */
export function orphanAuthAccounts(allLogins: LoginRow[], auth: Map<string, AuthAccount>): AuthAccount[] {
  const used = new Set(allLogins.map((l) => l.auth_user_id).filter(Boolean))
  return [...auth.values()].filter((a) => !used.has(a.id))
}
