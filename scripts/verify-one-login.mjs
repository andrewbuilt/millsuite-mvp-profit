// ============================================================================
// verify-one-login.mjs — one person, one login (STATE 2026-11-06 root fix)
// ============================================================================
// Run: npx tsx scripts/verify-one-login.mjs      (no DB, no network)
//
//   A. The three real victims, as fixtures, are REFUSED by the create paths:
//      Evan_o via /join, Kaylin's gmail via /join, a second login for a row
//      that has one via /team — each with a message that names the login to
//      use instead. A genuinely new person is NOT refused.
//   B. The standing diagnostic (loginIssues) flags every shape it promises,
//      and a clean org reads clean.
//   C. Static: both mint paths ask findLoginConflict BEFORE creating anything;
//      /join prechecks before signUp and no longer trusts the body's id.
// ============================================================================

import fs from 'fs'
import path from 'path'
const L = await import('../lib/login-dupes.ts')

let pass = 0
let fail = 0
const ok = (label, cond, detail) => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${!cond && detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''}`)
}

const ORG = 'built'
const login = (id, name, email, role, auth = `a-${id}`) => ({ id, org_id: ORG, name, email, role, auth_user_id: auth })
// Built as it stood when Evan hit it (STATE 11-03 findings).
const logins = [
  login('u-andrew', 'Andrew Watson', 'andrew@builtthings.com', 'owner'),
  login('u-kaylin', 'Kaylin Price', 'kaylin@builtthings.com', 'admin'),
  login('u-evan', 'Evan Otero', 'evan@builtthings.com', 'admin'),
  login('u-trent', 'Trent Trask', 'trent@builtthings.com', 'member'),
]
const roster = [
  { id: 'm-andrew', name: 'Andrew Watson', email: 'andrew@builtthings.com', user_id: 'u-andrew' },
  { id: 'm-kaylin', name: 'Kaylin Price', email: 'kaylin@builtthings.com', user_id: 'u-kaylin' },
  { id: 'm-evan', name: 'Evan Otero', email: 'evan@builtthings.com', user_id: 'u-evan' },
  { id: 'm-trent', name: 'Trent Trask', email: 'trent@builtthings.com', user_id: 'u-trent' },
  { id: 'm-austin', name: 'Austin Loper', email: 'austin@builtthings.com', user_id: null },
  { id: 'm-kaleigh', name: 'Kaleigh', email: null, user_id: null },
]

// ── names ──────────────────────────────────────────────────────────────────
ok('names: "Evan_o" ~ "Evan Otero"', L.namesLookAlike('Evan_o', 'Evan Otero'))
ok('names: "kaylinprice23" ~ "Kaylin Price"', L.namesLookAlike('kaylinprice23', 'Kaylin Price'))
ok('names: "evan" ~ "Evan Otero"', L.namesLookAlike('evan', 'Evan Otero'))
ok('names: "Evan Smith" ≁ "Evan Otero"', !L.namesLookAlike('Evan Smith', 'Evan Otero'))
ok('names: "Austin Loper" ≁ "Andrew Watson"', !L.namesLookAlike('Austin Loper', 'Andrew Watson'))
ok('mask: public page shows only the domain', L.maskEmail('evan.otero@builtthings.com') === '•••@builtthings.com')

// ── A. the create paths refuse the real shapes ────────────────────────────
{
  const evanJoin = L.findLoginConflict({ email: 'evan.o.otero@gmail.com', name: 'Evan_o' }, logins, roster)
  ok('/join: "Evan_o" with a new gmail → refused, points at Evan Otero\'s login', evanJoin?.kind === 'person_has_login' && evanJoin.login.id === 'u-evan', evanJoin)
  const msg = L.joinConflictMessage(evanJoin, 'Built')
  ok('/join message: sign in with the existing one, manager can reset, email masked', /already have a login at Built/.test(msg) && /•••@builtthings\.com/.test(msg) && /reset/.test(msg) && !/evan@/.test(msg), msg)
  const kaylin = L.findLoginConflict({ email: 'kaylinprice23@gmail.com', name: 'Kaylin' }, logins, roster)
  ok('/join: Kaylin on her gmail → refused (her roster row has a login)', kaylin?.kind === 'person_has_login' && kaylin.login.id === 'u-kaylin', kaylin)
  const sameEmail = L.findLoginConflict({ email: 'Trent@BuiltThings.com', name: 'T' }, logins, roster)
  ok('/join: an email that already has a login (any case) → refused', sameEmail?.kind === 'email_taken')
  const austin = L.findLoginConflict({ email: 'austin@builtthings.com', name: 'Austin Loper' }, logins, roster)
  ok('/join: Austin (on the roster, no login yet) → allowed', austin === null, austin)
  ok('/join: …and his login LINKS to his roster row by email', L.rosterMatchForJoin('AUSTIN@builtthings.com', roster)?.id === 'm-austin')
  const stranger = L.findLoginConflict({ email: 'mike@gmail.com', name: 'Mike Johnson' }, logins, roster)
  ok('/join: a brand-new person → allowed (no roster match, no lookalike)', stranger === null && L.rosterMatchForJoin('mike@gmail.com', roster) === null)

  const second = L.findLoginConflict({ email: 'evan2@builtthings.com', name: 'Evan Otero', memberId: 'm-evan' }, logins, roster)
  ok('/team: Create login on a row that HAS one → refused (Reset / Change login)', second?.kind === 'member_has_login' && /Reset password or Change login/.test(L.conflictMessage(second, 'Evan Otero')))
  const takenEmail = L.findLoginConflict({ email: 'evan@builtthings.com', name: 'Austin Loper', memberId: 'm-austin' }, logins, roster)
  ok('/team: an email already on another person\'s login → refused, names who has it', takenEmail?.kind === 'email_taken' && /linked to Evan Otero/.test(L.conflictMessage(takenEmail, 'Austin Loper')))
  const withOrphan = [...logins, login('u-evan-o', 'Evan_o', 'evan.o@gmail.com', 'member')]
  const relink = L.findLoginConflict({ email: 'austin.l@gmail.com', name: 'Austin Loper', memberId: 'm-austin' }, [...withOrphan, login('u-al', 'austin_l', 'al@gmail.com', 'member')], roster)
  ok('/team: an UNLINKED login that looks like this person → refused, "Link existing"', relink?.kind === 'unlinked_lookalike' && relink.login.id === 'u-al' && /Link existing/.test(L.conflictMessage(relink, 'Austin Loper')), relink)
  const fresh = L.findLoginConflict({ email: 'kaleigh@builtthings.com', name: 'Kaleigh', memberId: 'm-kaleigh' }, logins, roster)
  ok('/team: a row with no login and no lookalike → allowed', fresh === null, fresh)
}

// ── B. the diagnostic ──────────────────────────────────────────────────────
{
  const auth = new Map(
    [
      ['a-u-andrew', '2026-11-04'], ['a-u-kaylin', '2026-11-03'], ['a-u-evan', '2026-09-09'], ['a-u-trent', '2026-11-04'],
      ['a-u-evan-o', '2026-09-22'], ['a-u-kp', '2026-09-01'], ['a-stray', null],
    ].map(([id, last]) => [id, { id, email: null, banned: id === 'a-u-trent', lastSignIn: last }]),
  )
  const all = [
    ...logins,
    login('u-evan-o', 'Evan_o', 'evan.o@gmail.com', 'member'),
    login('u-kp', 'Kaylin', 'kaylinprice23@gmail.com', 'member'),
    login('u-ghost', 'Andrew', null, 'member', null),
    login('u-dead', 'Old Login', 'old@builtthings.com', 'member', 'a-gone'),
    { id: 'u-other', org_id: 'other', name: 'Elsewhere', email: 'kaylin@builtthings.com', role: 'owner', auth_user_id: 'a-u-kp' },
  ]
  const r = [...roster, { id: 'm-dup', name: 'Kaylin (2)', user_id: 'u-kaylin' }, { id: 'm-x', name: 'Cross', user_id: 'u-other' }, { id: 'm-miss', name: 'Missing', user_id: 'u-nope' }]
  const issues = L.loginIssues({ id: ORG, name: 'Built', roster: r }, all, auth)
  const has = (kind, re) => issues.some((i) => i.kind === kind && (!re || re.test(i.who + ' ' + i.detail)))
  ok('diag: Evan_o = manager_signs_in_as_worker, with both last sign-ins', has('manager_signs_in_as_worker', /Evan_o[\s\S]*Evan Otero[\s\S]*2026-09-22[\s\S]*2026-09-09/), issues.filter((i) => /Evan/.test(i.who)))
  ok('diag: Kaylin\'s gmail member login flagged against her roster row', has('manager_signs_in_as_worker', /kaylinprice23/) || has('duplicate_person', /kaylinprice23/))
  ok('diag: the orphan "Andrew" row with no auth account', has('no_auth_account', /Andrew/))
  ok('diag: a users row pointing at a deleted auth account', has('dead_auth_account', /Old Login/))
  ok('diag: two users rows sharing an email (across orgs)', has('duplicate_email', /kaylin@builtthings\.com/))
  ok('diag: two roster rows on one login', has('two_rows_one_login', /Kaylin Price \+ Kaylin \(2\)/))
  ok('diag: roster → a login in another org', has('roster_points_cross_org', /Cross/))
  ok('diag: roster → no users row', has('roster_points_at_missing', /Missing/))
  ok('diag: active roster row → a disabled login (Trent)', has('roster_points_at_disabled', /Trent/))
  const hint = L.loginIssues({ id: ORG, name: 'Built', roster }, [...logins, login('u-mark', 'Mark McGee', 'pyromark@aol.com', 'member')], new Map([['a-u-mark', { id: 'a-u-mark', email: null, banned: false, lastSignIn: null }], ...logins.map((l) => [l.auth_user_id, { id: l.auth_user_id, email: l.email, banned: false, lastSignIn: null }])]))
  ok('diag: an unlinked login with no roster match says "add them on /team"', hint.some((i) => i.kind === 'unlinked_login' && /no roster row matches/.test(i.detail)), hint)
  const hint2 = L.loginIssues({ id: ORG, name: 'Built', roster: [...roster, { id: 'm-mark', name: 'Mark McGee', email: null, user_id: null }] }, [...logins, login('u-mark', 'Mark McGee', 'pyromark@aol.com', 'member')], new Map([['a-u-mark', { id: 'a-u-mark', email: null, banned: false, lastSignIn: null }], ...logins.map((l) => [l.auth_user_id, { id: l.auth_user_id, email: l.email, banned: false, lastSignIn: null }])]))
  ok('diag: an unlinked login with a waiting roster row names it → Link existing', hint2.some((i) => i.kind === 'unlinked_login' && /"Mark McGee": \/team → Mark McGee → Link existing/.test(i.detail)), hint2)
  ok('diag: auth account with no profile anywhere', L.orphanAuthAccounts(all, auth).some((a) => a.id === 'a-stray'))
  const clean = L.loginIssues({ id: ORG, name: 'Built', roster }, logins, new Map(logins.map((l) => [l.auth_user_id, { id: l.auth_user_id, email: l.email, banned: false, lastSignIn: '2026-11-01' }])))
  ok('diag: a clean org reads clean', clean.length === 0, clean)
}

// ── C. static ──────────────────────────────────────────────────────────────
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const admin = read('app/api/admin/users/route.ts')
const createBlock = admin.slice(admin.indexOf("action === 'create_login'"), admin.indexOf("action === 'set_role'"))
ok('/team create_login asks findLoginConflict BEFORE auth.admin.createUser', createBlock.indexOf('findLoginConflict(') > 0 && createBlock.indexOf('findLoginConflict(') < createBlock.indexOf('createUser('))
ok('/team create_login refuses with 409 + the message', /status: 409/.test(createBlock) && /conflictMessage\(/.test(createBlock))
ok('/team link_login refuses a login another roster row holds', /already linked to \$\{holder\.name\}/.test(admin))
ok('/team sends member_id on create + link', /action: 'create_login',[\s\S]{0,200}member_id: member\.id/.test(read('app/(app)/team/page.tsx')) && /action: 'link_login', user_id: userId, member_id: member\.id/.test(read('app/(app)/team/page.tsx')))
const join = read('app/api/auth/join/route.ts')
ok('/join route: precheck + re-check before the users insert', /body\.precheck === true/.test(join) && join.indexOf('conflictFor(org.id') < join.indexOf(".from('users')\n      .insert"))
ok('/join route: verifies the auth account server-side (no trusting the body id)', /auth\.admin\.getUserById\(authUserId\)/.test(join) && /normEmail\(authUser\.email\) !== email/.test(join))
ok('/join route: a refused join deletes only a fresh, profile-less auth account', /15 \* 60 \* 1000/.test(join) && /discardFreshAuth\(\)/.test(join))
ok('/join route: an email matching an unlinked roster row links it', /rosterMatchForJoin\(email, roster\)/.test(join) && /user_id: user\.id/.test(join))
const joinPage = read('app/(marketing)/join/[slug]/page.tsx')
ok('/join page: precheck runs BEFORE supabase.auth.signUp', joinPage.indexOf('precheck: true') > 0 && joinPage.indexOf('precheck: true') < joinPage.indexOf('auth.signUp('))

ok('diagnostic script: --live hides orgs nobody can sign in to', /--live/.test(read('scripts/inspect-logins.mjs')) && /liveOnly && !liveOrg\(o\.id\)/.test(read('scripts/inspect-logins.mjs')))

{
  // inspect-duplicate-logins' REFS must cover every column that references
  // users(id) — a missing one reads as "safe to delete" (it did, 2026-11-04).
  const migDir = path.join(root, 'db/migrations')
  const want = new Set()
  for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith('.sql'))) {
    let table = null
    for (const line of fs.readFileSync(path.join(migDir, f), 'utf8').split('\n')) {
      const t = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)/i.exec(line) || /ALTER TABLE (?:public\.)?(\w+)/i.exec(line)
      if (t) table = t[1]
      const c = /(\w+)\s+uuid[^,;]*REFERENCES\s+(?:public\.)?users\s*\(id\)/i.exec(line)
      if (c && table) want.add(`${table}.${c[1]}`)
    }
  }
  const refsSrc = read('scripts/login-refs.mjs')
  const missing = [...want].filter((tc) => { const [t, c] = tc.split('.'); return !refsSrc.includes(`['${t}', '${c}']`) })
  ok(`login-refs (inspect + fix-duplicate-logins) covers every users(id) reference in the migrations (${want.size})`, missing.length === 0, missing)
}

ok('fix-duplicate-logins fails closed on a column it could not read', /UNCHECKED/.test(read('scripts/fix-duplicate-logins.mjs')) && /loginReferences\(db, userId\)/.test(read('scripts/fix-duplicate-logins.mjs')))
ok('both login scripts use the ONE shared list', /from '\.\/login-refs\.mjs'/.test(read('scripts/inspect-duplicate-logins.mjs')) && /from '\.\/login-refs\.mjs'/.test(read('scripts/fix-duplicate-logins.mjs')) && !/const REFS = \[/.test(read('scripts/inspect-duplicate-logins.mjs') + read('scripts/fix-duplicate-logins.mjs')))

console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
