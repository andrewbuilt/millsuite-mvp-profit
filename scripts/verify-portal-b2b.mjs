// ============================================================================
// verify-portal-b2b.mjs — the B2B pre-approval portal + type grouping (135)
// ============================================================================
// Run: npx tsx scripts/verify-portal-b2b.mjs     (pure + static, no database)
//
// PURE   — the type guess (and that migration 135's SQL backfill uses the very
//          same patterns), the pills, the public read model's counts / groups /
//          lead time / activity, the contact allowlist, the notify queue, and
//          the token gate refusing junk before it reaches the database.
// ⛔ ONE — NO ANON GRANTS: 135 gives the public key nothing; the portal's
//          routes and page touch the database only through the service-role
//          lib; nothing public imports the browser client.
// ⛔ TWO — NO MONEY, NO INTERNAL NOTES: poisoned raw rows go through the real
//          read model and none of it comes out; every column list the portal
//          selects is checked name by name; the payload type has no field for
//          any of it.
// STATIC — it's wired, not just compiled: approve writes the signed revision,
//          a question creates the task, contact edits log an event, /p is
//          reserved + public, the pre-production page has the picker, the
//          grouping, the photos, the questions, the lead time, the link and
//          the notify-first queue — and nothing auto-sends.
// ============================================================================

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

let failures = 0
let checks = 0
const ok = (cond, msg) => {
  checks++
  if (!cond) {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const read = (p) => fs.readFileSync(p, 'utf8')
const stripSqlComments = (s) => s.replace(/--[^\n]*/g, '')
// Line comments FIRST, and block comments only where one starts a line: this
// repo's headers say things like "app/api/p/**", and the view has
// accept="image/*" — a naive /* … */ strip swallows half the file from there.
const stripTsComments = (s) =>
  s
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

// The libs build Supabase clients at import; nothing here touches the network.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unused'

const kindLib = await import('../lib/approval-kind.ts')
const view = await import('../lib/preapproval-view.ts')
const admin = await import('../lib/preapproval-admin.ts')
const server = await import('../lib/preapproval-portal.ts')

// ── PURE — type grouping ────────────────────────────────────────────────────
console.log('PURE — Finish / Hardware / Drawing / Other')
const { guessItemKind, groupByKind, safeHttpUrl, normalizeItemKind } = kindLib
ok(guessItemKind({ label: 'Exterior finish', finish: 'Matte lacquer' }) === 'finish', 'a finish label is a finish')
ok(guessItemKind({ label: 'Carcass material', material: 'White oak' }) === 'finish', 'a material is filed under Finishes')
ok(guessItemKind({ label: 'Amerock Pulls - Candler 96mm' }) === 'hardware', 'pulls are hardware')
ok(guessItemKind({ label: 'Pulls', finish: 'Satin nickel finish' }) === 'hardware', 'a hardware LABEL beats a finish value')
ok(guessItemKind({ label: 'Hinges', material: 'Blum soft-close' }) === 'hardware', 'hinges are hardware')
ok(guessItemKind({ label: 'Soft-close', material: 'Blum drawer slide' }) === 'hardware', 'hardware in the detail text counts')
ok(guessItemKind({ label: 'Shop drawings' }) === 'drawing', 'drawings are drawings')
ok(guessItemKind({ label: 'Feature', material: '15 LF LED COB strip' }) === 'other', 'an LED run is Other, not a guess')
ok(guessItemKind({ label: 'Cabinet', finish: 'Painted' }) === 'finish', 'anything carrying a finish is a finish')
ok(guessItemKind({ label: '' }) === 'other', 'nothing to go on → Other')
ok(normalizeItemKind('nonsense') === 'other' && normalizeItemKind(null) === 'other', 'an unknown kind reads as Other')
const grouped = groupByKind([{ item_kind: 'other' }, { item_kind: 'hardware' }, { item_kind: 'finish' }, { item_kind: null }])
ok(eq(grouped.map((g) => g.label), ['Finishes', 'Hardware', 'Other']), 'groups come out in the fixed order, empty ones dropped')
ok(grouped[2].rows.length === 2, 'a null kind lands in Other')
ok(safeHttpUrl('javascript:alert(1)') === null, 'a javascript: link never becomes an href')
ok(safeHttpUrl('richelieu.com/BP98765') === 'https://richelieu.com/BP98765', 'a bare domain gets https')
ok(safeHttpUrl('  ') === null, 'a blank link is no link')

const sql135 = read('db/migrations/135_preapproval_portal.sql')
for (const [name, re] of [
  ['HARDWARE_LABEL_RE', kindLib.HARDWARE_LABEL_RE],
  ['FINISH_LABEL_RE', kindLib.FINISH_LABEL_RE],
  ['DRAWING_LABEL_RE', kindLib.DRAWING_LABEL_RE],
  ['HARDWARE_DETAIL_RE', kindLib.HARDWARE_DETAIL_RE],
]) {
  ok(sql135.includes(`~* '${re.source}'`), `135's backfill uses the same pattern as ${name}`)
}

// ── PURE — the public read model ────────────────────────────────────────────
console.log('PURE — the portal read model')
const POISON = ['184250', 'INTERNAL', 'SECRET-GATE-CODE', '41.5', 'storage/secret/path.jpg', 'task-uuid-1', 'user-uuid-9']
const NOW = new Date('2026-11-24T15:00:00Z')
const raw = {
  orgName: 'BUILT',
  team: { name: 'Kaylin', title: 'Project Manager', email: 'k@built.test', phone: '555-0142', shopAddress: '1 Shop Rd' },
  project: {
    id: 'p1', name: 'Hunt — Reception', client_name: 'Pajot Millwork', sold_at: '2026-11-12T15:00:00Z',
    lead_time_weeks: 8, portal_token_issued_at: '2026-11-12T16:00:00Z', poc_name: 'Dave Pajot',
    poc_email: 'dave@pajot.test', poc_phone: '555-0177', delivery_address: '601 E Kennedy', client_deadline: 'March 1',
    // Columns a real loader never selects — proving the model copies by name.
    bid_total: 184250, labor_margin_pct: 38, locked_shop_rate: 95, site_access_notes: 'SECRET-GATE-CODE',
    portal_token: 'tok_INTERNAL', internal_notes: 'INTERNAL slow payer',
    handoff_contacts: [
      { id: 'c1', category: 'gc', name: 'David A', phone: '941-555-0111', email: 'gc@x.test', margin_note: 'INTERNAL gc is slow' },
      { id: 'c2', category: 'nonsense', name: 'Dana D', phone: null, email: null },
      { id: 'c3', category: 'designer', name: '   ', phone: '555', email: null },
    ],
  },
  subs: [
    { id: 's2', name: 'Conference', sort_order: 2 },
    { id: 's1', name: 'Reception', sort_order: 1 },
    { id: 's3', name: 'Mailroom', sort_order: 3 },
  ],
  items: [
    { id: 'i1', subproject_id: 's1', label: 'White Oak', material: 'natural', finish: 'clear', state: 'in_review', ball_in_court: 'client', last_state_change_at: '2026-11-19T16:30:00Z', item_kind: 'finish', link_url: null, created_at: '2026-11-12T01:00:00Z', custom_material_cost_per_lf: 41.5 },
    { id: 'i2', subproject_id: 's1', label: 'PLAM 949', material: null, finish: null, state: 'approved', ball_in_court: null, last_state_change_at: '2026-11-17T19:14:00Z', item_kind: 'finish', link_url: null, created_at: '2026-11-12T02:00:00Z' },
    { id: 'i3', subproject_id: 's1', label: 'Pulls', material: null, finish: null, state: 'approved', ball_in_court: null, last_state_change_at: '2026-11-17T19:16:00Z', item_kind: 'hardware', link_url: 'javascript:alert(1)', created_at: '2026-11-12T03:00:00Z' },
    { id: 'i4', subproject_id: 's1', label: 'Hinges', material: null, finish: null, state: 'pending', ball_in_court: 'shop', last_state_change_at: '2026-11-18T10:00:00Z', item_kind: 'hardware', link_url: 'https://blum.com/x', created_at: '2026-11-12T04:00:00Z' },
    { id: 'i5', subproject_id: 's1', label: 'Priced swap', material: null, finish: null, state: 'in_review', ball_in_court: 'client', last_state_change_at: '2026-11-18T10:00:00Z', item_kind: 'other', link_url: null, created_at: '2026-11-12T05:00:00Z' },
    { id: 'i6', subproject_id: 's3', label: 'Laminate', material: null, finish: null, state: 'approved', ball_in_court: null, last_state_change_at: '2026-11-15T10:00:00Z', item_kind: 'finish', link_url: null, created_at: '2026-11-12T06:00:00Z' },
  ],
  itemRevisions: [
    { id: 'r1', approval_item_id: 'i2', action: 'approved', note: 'Approved in the portal', actor_name: 'Dave Pajot', occurred_at: '2026-11-17T19:14:00Z' },
    { id: 'r2', approval_item_id: 'i3', action: 'approved', note: 'INTERNAL override — sign-off outside MillSuite', actor_name: null, occurred_at: '2026-11-17T19:16:00Z' },
    { id: 'r3', approval_item_id: 'i4', action: 'client_requested_change', note: 'make them brass', actor_name: 'Dave Pajot', occurred_at: '2026-11-18T10:00:00Z' },
    { id: 'r4', approval_item_id: 'i6', action: 'approved', note: '(auto) linked to i2', actor_name: 'Dave Pajot', occurred_at: '2026-11-15T10:00:00Z' },
    { id: 'r5', approval_item_id: 'gone', action: 'approved', note: 'INTERNAL other project', actor_name: null, occurred_at: '2026-11-15T10:00:00Z' },
  ],
  drawings: [
    { id: 'd1', subproject_id: 's1', revision_number: 1, file_url: null, state: 'pending', is_latest: false, submitted_at: '2026-11-13T10:00:00Z', responded_at: '2026-11-14T10:00:00Z', responded_by_name: null, notes: 'INTERNAL redraw' },
    { id: 'd2', subproject_id: 's1', revision_number: 2, file_url: null, state: 'pending', is_latest: false, submitted_at: '2026-11-16T10:00:00Z', responded_at: '2026-11-18T14:02:00Z', responded_by_name: 'Dave Pajot', notes: 'extend the top 4"' },
    { id: 'd3', subproject_id: 's1', revision_number: 3, file_url: 'https://drive.google.com/x', state: 'in_review', is_latest: true, submitted_at: '2026-11-21T20:47:00Z', responded_at: null, responded_by_name: null, notes: null },
    { id: 'd4', subproject_id: 's3', revision_number: 1, file_url: null, state: 'approved', is_latest: true, submitted_at: '2026-11-14T10:00:00Z', responded_at: '2026-11-15T10:00:00Z', responded_by_name: null, notes: 'Manually approved (no revision uploaded) INTERNAL' },
  ],
  photos: [
    { id: 'ph1', approval_item_id: 'i1', caption: 'sample', added_by: 'Hunter Cole', from_client: false, created_at: '2026-11-19T16:42:00Z', url: 'https://signed/1', storage_path: 'storage/secret/path.jpg' },
    { id: 'ph2', approval_item_id: 'i1', caption: null, added_by: 'Hunter Cole', from_client: false, created_at: '2026-11-19T16:43:00Z', url: 'https://signed/2' },
  ],
  questions: [
    { id: 'q1', body: 'Uppers to the deck?', author_name: 'Dave Pajot', created_at: '2026-11-18T13:40:00Z', answer: 'Yes.', answered_at: '2026-11-18T15:02:00Z', answered_by_label: 'Kaylin', task_id: 'task-uuid-1', answered_by: 'user-uuid-9' },
    { id: 'q2', body: 'When is install?', author_name: 'Dave Pajot', created_at: '2026-11-20T13:40:00Z', answer: null, answered_at: null, answered_by_label: null },
  ],
  events: [
    { id: 'e1', event_type: 'portal_contact_edit', label: 'Dave Pajot updated the jobsite deadline', created_at: '2026-11-15T13:51:00Z', meta: { from: 'INTERNAL old', to: 'x' } },
    { id: 'e2', event_type: 'margin_changed', label: 'INTERNAL margin to 31%', created_at: '2026-11-16T13:51:00Z' },
  ],
  blockedItemIds: ['i5'],
}
const v = view.buildPortalView(raw, NOW)
const all = v.subs.flatMap((s) => s.groups.flatMap((g) => g.items))
ok(eq(v.subs.map((s) => s.name), ['Reception', 'Conference', 'Mailroom']), 'subprojects come out in the shop’s sort order')
// 6 callouts + one drawing track per subproject (3) = 9
ok(v.status.total === 9, `every callout + one drawing track per subproject is counted (${v.status.total})`)
ok(v.status.approved === 4, `approved count (${v.status.approved})`)
ok(v.status.waitingOnYou === 2, `waiting on you = the in-review callout + the in-review drawing (${v.status.waitingOnYou})`)
ok(v.status.inOurCourt === 3, `in our court = shop-side callout + the CO-blocked one + drawings not yet submitted (${v.status.inOurCourt})`)
ok(v.status.approved + v.status.waitingOnYou + v.status.inOurCourt === v.status.total, 'the three piles add up to the total')
ok(v.status.daysInPrepro === 12, 'days in pre-production = now − sold_at')
ok(view.daysInPrepro(null, NOW) === null, 'no sold_at → no number, not a guess')
const rec = v.subs[0]
ok(rec.approved === 2 && rec.total === 6 && !rec.allApproved, 'subproject header counts "N of M approved"')
ok(v.subs[2].allApproved && v.subs[2].total === 2, 'an all-approved subproject says so')
ok(v.subs[1].total === 1 && v.subs[1].groups[0].items[0].pill === 'shop' && v.subs[1].groups[0].items[0].id === null, 'a subproject with no drawings yet shows one "in our court" drawing row with nothing to click')
ok(eq(rec.groups.map((g) => g.label), ['Finishes', 'Hardware', 'Drawings', 'Other']), 'inside a subproject: Finishes / Hardware / Drawings / Other')
const byId = Object.fromEntries(all.filter((i) => i.id).map((i) => [i.id, i]))
ok(byId.i1.pill === 'waiting' && byId.i1.canAct, 'ball with the client → Waiting on you, actionable')
ok(byId.i4.pill === 'shop' && !byId.i4.canAct, 'ball with the shop → In our court, no buttons')
ok(byId.i5.pill === 'shop' && !byId.i5.canAct, '⛔ a callout with a draft change order is never one-click approvable')
ok(byId.i2.statusText === 'Approved by Dave Pajot' && byId.i2.statusAt === '2026-11-17T19:14:00Z', 'approved + who + timestamp')
ok(byId.i3.statusText === 'Approved · recorded by BUILT', 'an in-app approval names the shop, never a teammate')
ok(byId.i4.statusText.includes('make them brass'), 'the client’s OWN change note is echoed back')
ok(byId.i3.linkUrl === null && byId.i4.linkUrl === 'https://blum.com/x', 'hardware link shown only when it’s a real http(s) URL')
ok(byId.i1.photos.length === 2 && byId.i1.photosNote.by === 'BUILT', 'shop photos are credited to the shop, not the uploader')
ok(byId.d3.type === 'drawing' && byId.d3.pill === 'waiting' && byId.d3.viewUrl === 'https://drive.google.com/x', 'latest in-review drawing is with the client, with its link')
ok(eq(byId.d3.priorNotes.map((n) => n.rev), [2]) && byId.d3.priorNotes[0].note === 'extend the top 4"', 'prior-rev change requests: only the ones the client typed')
ok(v.leadTime.completionDate === '2027-01-19' && v.leadTime.weeks === 8, 'lead time: today + 8 weeks = Jan 19, 2027')
ok(view.buildPortalView({ ...raw, project: { ...raw.project, lead_time_weeks: null } }, NOW).leadTime === null, 'no lead time → the callout is absent')
ok(view.leadTimeCompletion(0, NOW) === null && view.leadTimeCompletion(-2, NOW) === null, 'a zero / negative lead time hides too')
ok(v.questions.length === 2 && v.questions[0].answeredBy === 'Kaylin' && v.questions[1].answer === null, 'questions carry their answer + who + when')
const times = v.activity.map((a) => new Date(a.at).getTime())
ok(times.every((t, i) => i === 0 || times[i - 1] >= t), 'activity is newest-first')
ok(v.activity.some((a) => a.kind === 'contact' && a.who === 'Dave Pajot' && a.text === 'updated the jobsite deadline'), 'contact edits are in the activity')
ok(v.activity.filter((a) => a.kind === 'photo').length === 1 && v.activity.find((a) => a.kind === 'photo').text === 'added 2 photos to White Oak', 'photos batch into one line')
ok(v.activity.some((a) => a.kind === 'answer') && v.activity.some((a) => a.kind === 'question'), 'questions and answers are in the activity')
ok(!v.activity.some((a) => a.text.includes('Laminate')), 'a linked slot’s mirrored revision isn’t a second line')
ok(v.updatedAt === v.activity[0].at, '"updated" is the newest activity')

console.log('⛔ TWO — no money, no internal notes, in the payload')
const out = JSON.stringify(v)
for (const p of POISON) ok(!out.includes(p), `poison value "${p}" never reaches the payload`)
const BANNED_KEY = /bid|margin|cost|price|rate\b|hours|payment|deposit|invoice|internal|site_access|storage_path|task_id|answered_by"|portal_token|org_id|actor_user/i
const keys = new Set()
JSON.stringify(v, (k, val) => (keys.add(k), val))
ok(![...keys].some((k) => BANNED_KEY.test(k)), `no payload KEY names money / internals (${[...keys].filter((k) => BANNED_KEY.test(k)).join(', ') || 'clean'})`)
const typeSrc = stripTsComments(read('lib/preapproval-view.ts'))
const payloadType = typeSrc.slice(typeSrc.indexOf('export interface PreapprovalPortal'), typeSrc.indexOf('// ── Small pure pieces') > 0 ? undefined : undefined)
ok(/export interface PreapprovalPortal \{[\s\S]*?\n\}/.test(payloadType), 'the payload type is where the verify script expects it')
const payloadBlock = /export interface PreapprovalPortal \{[\s\S]*?\n\}/.exec(payloadType)[0]
ok(!/bid|margin|cost|price|payment|deposit|internal|notes\b|siteAccess/i.test(payloadBlock), 'PreapprovalPortal has no field for money or internal notes')
ok(!/\.\.\.(item|p|q|ph|d|r|e|input\.project|project)\b/.test(typeSrc), 'the read model never spreads a raw row (it copies by name)')

console.log('PURE — other contacts (136)')
const hc = await import('../lib/handoff-contacts.ts')
ok(eq(v.you.contacts.map((c) => [c.categoryLabel, c.name]), [['GC', 'David A'], ['Other', 'Dana D']]), 'the portal lists the job’s other contacts with their category; nameless rows dropped, unknown category → Other')
ok(eq(Object.keys(v.you.contacts[0]).sort(), ['category', 'categoryLabel', 'email', 'id', 'name', 'phone']), 'a contact is copied by name — six fields, nothing else rides along')
const base = [{ id: 'c1', category: 'gc', name: 'David A', phone: '941-555-0111', email: 'gc@x.test' }]
let m = hc.mergeClientContacts(base, [{ id: 'c1', category: 'gc', name: 'David Andrukaitis', phone: '', email: '' }, { category: 'designer', name: 'Dana Design', phone: '555-0199', email: 'dana@x.test' }])
ok(m.contacts.length === 2 && m.contacts[0].name === 'David Andrukaitis' && m.contacts[0].phone === '941-555-0111', 'a client can correct a contact; an emptied phone/email is left as it was')
ok(eq(m.changes.map((c) => hc.contactChangeText(c)), ['updated the GC contact', 'added a Designer contact']), 'each change reads as one activity line')
m = hc.mergeClientContacts(base, [])
ok(m.contacts.length === 1 && m.changes.length === 0, '⛔ leaving a contact out does NOT remove it — a client can never delete')
m = hc.mergeClientContacts(base, [{ id: 'c1', category: 'gc', name: '', phone: '', email: '' }])
ok(m.contacts[0].name === 'David A' && m.changes.length === 0, '⛔ blanking a contact’s name does not delete or change it')
m = hc.mergeClientContacts(base, [{ id: 'c1', category: 'gc', name: 'David A', phone: '941-555-0111', email: 'gc@x.test' }])
ok(m.changes.length === 0, 'an unchanged contact is not a change')
m = hc.mergeClientContacts(base, [{ category: 'owner', name: 'O', email: 'not-an-email' }])
ok(m.error && m.changes.length === 0, 'a bad email is refused')
const full = Array.from({ length: hc.MAX_HANDOFF_CONTACTS }, (_, i) => ({ id: `x${i}`, category: 'other', name: `P${i}`, phone: null, email: null }))
ok(hc.mergeClientContacts(full, [{ category: 'gc', name: 'One more' }]).error, 'the list is capped — a public link can’t grow it without bound')
ok(hc.mergeClientContacts(base, 'junk').contacts.length === 1 && hc.mergeClientContacts(null, null).contacts.length === 0, 'junk input changes nothing')
ok(hc.contactChangeText({ kind: 'added', category: 'owner' }) === 'added an Owner contact', '“an Owner”, not “a Owner”')
ok(hc.normalizeHandoffContacts([{ name: 'A', id: 'd' }, { name: 'B', id: 'd' }]).map((c) => c.id).filter((x, i, a) => a.indexOf(x) === i).length === 2, 'duplicate ids are settled')
ok(view.buildActivity({ ...raw, events: [{ id: 'e9', event_type: 'portal_contact_edit', label: 'Dave Pajot added a Designer contact', created_at: '2026-11-22T10:00:00Z' }] }).some((a) => a.who === 'Dave Pajot' && a.text === 'added a Designer contact'), 'an added contact shows in the activity')
const handoffSrc = read('lib/handoff.ts')
ok(/update\(\{ handoff_contacts: clean \}\)\s*\.eq\('id', projectId\)\s*\.select\('id'\)/.test(handoffSrc) && /if \(!data \|\| data\.length === 0\) throw new Error\('The project could not be updated\.'\)/.test(handoffSrc), 'the shop’s save selects back; zero rows = failure')
ok(!/handoff_contacts/.test(handoffSrc.slice(handoffSrc.indexOf('export function handoffMissing'), handoffSrc.indexOf('export function handoffMissingPhrase'))), 'the production gate still reads only the point of contact')
ok(/<OtherContacts projectId=\{projectId\} \/>/.test(read('components/project/HandoffCard.tsx')) && /CONTACT_CATEGORIES\.map/.test(read('components/project/HandoffCard.tsx')), 'the Handoff card has the contacts list with a category picker')
ok(/mergeClientContacts\(\(cur as \{ handoff_contacts\?: unknown \} \| null\)\?\.handoff_contacts, body\?\.contacts\)/.test(read('lib/preapproval-portal.ts')), 'the portal’s contact write goes through the add-and-correct-only merge')

console.log('PURE — contact edits, names, notify queue')
const cur = { poc_name: 'Dave', delivery_address: '601 E Kennedy', client_deadline: 'March 1' }
ok(eq(view.contactChanges(cur, { client_deadline: 'Feb 15' }), [{ field: 'client_deadline', value: 'Feb 15' }]), 'a changed field is a change')
ok(eq(view.contactChanges(cur, { delivery_address: '   ' }), []), '⛔ a blank never clears a handoff field')
ok(eq(view.contactChanges(cur, { client_deadline: 'March 1' }), []), 'an unchanged field is not a change')
ok(eq(view.contactChanges(cur, { bid_total: '1', site_access_notes: 'x', stage: 'lost', portal_token: 'x' }), []), '⛔ only the five handoff fields can be written from the portal')
ok(eq(Object.keys(view.PORTAL_CONTACT_FIELDS), ['poc_name', 'poc_email', 'poc_phone', 'delivery_address', 'client_deadline']), 'the contact allowlist is exactly the five')
ok(view.contactChanges(cur, null).length === 0 && view.contactChanges(cur, 'x').length === 0, 'junk input changes nothing')
ok(view.cleanPortalName('  Dave    Pajot \n') === 'Dave Pajot', 'a typed name is trimmed + collapsed')
ok(!view.isUsablePortalName('x') && !view.isUsablePortalName('  ..  ') && view.isUsablePortalName('Di'), 'a name needs two real characters')
ok(view.cleanPortalText('a'.repeat(5000), 1000).length === 1000, 'free text is capped')
const q1 = view.notifyQueue(v.activity, null, raw.project.portal_token_issued_at)
ok(q1.length > 0 && !q1.some((a) => a.kind === 'opened'), 'with no send yet, the queue starts at the link (minus "opened")')
ok(view.notifyQueue(v.activity, '2026-11-20T00:00:00Z', raw.project.portal_token_issued_at).every((a) => a.at > '2026-11-20'), 'the queue is only what changed since the last send')
ok(view.notifyQueue(v.activity, NOW.toISOString(), null).length === 0, 'stamping "sent" clears the queue')
ok(view.notifyQueue(v.activity, null, null).length === 0, 'no link yet → nothing to send')
const mail = view.buildNotifyEmail({ orgName: 'BUILT', projectName: 'Hunt', pocName: 'Dave Pajot', portalUrl: 'https://x.test/p/tok', queue: q1, waitingOnYou: 2 })
ok(mail.body.includes('https://x.test/p/tok') && mail.body.startsWith('Hi Dave,') && mail.body.includes('2 items are waiting'), 'the email has the greeting, the count and the link')
ok(!POISON.some((p) => mail.body.includes(p)), 'the email summary carries no poison either')
const href = view.mailtoHref('dave@pajot.test', mail)
ok(href.startsWith('mailto:dave%40pajot.test?subject=') && !/[\n ]/.test(href), 'mailto: is fully encoded')
ok(eq(admin.parseLeadTimeWeeks(''), { ok: true, weeks: null }) && eq(admin.parseLeadTimeWeeks('8.5'), { ok: true, weeks: 8.5 }) && !admin.parseLeadTimeWeeks('soon').ok && !admin.parseLeadTimeWeeks('-1').ok, 'lead time: empty clears, a number saves, junk is refused')
ok(admin.unansweredCount([{ answer: null }, { answer: ' ' }, { answer: 'yes' }]) === 2, 'the unanswered badge counts blank answers')

console.log('PURE — the token gate (no database reached)')
for (const bad of ['', 'short', 'has spaces in it 1234567890', '../../etc/passwd-aaaaaaaaaaaa', 'a'.repeat(200), "x' or 1=1 --aaaaaaaaaaaa"]) {
  ok((await server.resolveProjectPortalToken(bad)) === null, `token ${JSON.stringify(bad.slice(0, 24))} resolves to nothing`)
}
ok((await server.portalApprove('nope', { type: 'item', id: 'x', name: 'Dave Pajot' })).status === 404, 'approve with a bad token is a plain 404')
ok((await server.portalAskQuestion('nope', { name: 'Dave', body: 'hello there' })).status === 404, 'a question with a bad token is a plain 404')
ok((await server.portalEditContact('nope', { fields: { poc_name: 'x' } })).status === 404, 'a contact edit with a bad token is a plain 404')
ok(/^[A-Za-z0-9_-]{32}$/.test(server.mintProjectPortalToken()) && server.mintProjectPortalToken() !== server.mintProjectPortalToken(), 'minted tokens are 32 url-safe chars and unique')

// ── ⛔ ONE — no anon grants ─────────────────────────────────────────────────
console.log('⛔ ONE — no anon grants; service-role routes only')
const sql = stripSqlComments(sql135)
ok(!/\banon\b/i.test(sql), '135 never names the anon role')
ok(!/\bTO\s+public\b/i.test(sql) && !/GRANT\b/i.test(sql), '135 grants nothing (no GRANT, no TO public)')
ok(!/storage\.objects/i.test(sql), '135 adds no storage policy (private bucket, signed URLs only)')
ok(/'approval-photos',\s*\n\s*'approval-photos',\s*\n\s*false/.test(sql) && /SET public = false/.test(sql), 'the approval-photos bucket is PRIVATE')
for (const t of ['approval_item_photos', 'portal_questions']) {
  ok(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\b`).test(sql), `135 creates ${t} idempotently`)
  ok(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(sql), `${t} has RLS on`)
  ok(new RegExp(`CREATE POLICY ${t}_own_org ON public\\.${t}\\s+FOR ALL TO authenticated\\s+USING \\(org_id = public\\.current_org_id\\(\\)\\)\\s+WITH CHECK \\(org_id = public\\.current_org_id\\(\\)\\)`).test(sql), `${t}: one policy, authenticated + own org`)
  ok((sql.match(new RegExp(`CREATE POLICY \\w+ ON public\\.${t}\\b`, 'g')) || []).length === 1, `${t} has exactly one policy`)
  ok(read('scripts/rls-audit.mjs').includes(t), `rls-audit checks ${t}`)
}
for (const col of ['portal_token ', 'portal_token_issued_at', 'lead_time_weeks', 'portal_last_notified_at', 'link_url', 'actor_name', 'responded_by_name']) {
  ok(new RegExp(`ADD COLUMN IF NOT EXISTS ${col.trim()}\\b`).test(sql), `135 adds ${col.trim()} idempotently`)
}
ok(/CHECK \(item_kind IN \('finish', 'hardware', 'drawing', 'other'\)\)/.test(sql) && /DEFAULT 'other'/.test(sql), 'item_kind has its CHECK + default')
ok(/CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_portal_token[\s\S]*?WHERE portal_token IS NOT NULL/.test(sql), 'portal_token is unique where set')
ok(/approval_item_id uuid NOT NULL REFERENCES public\.approval_items\(id\) ON DELETE CASCADE/.test(sql) && /project_id\s+uuid NOT NULL REFERENCES public\.projects\(id\) ON DELETE CASCADE/.test(sql), 'both new tables cascade from their parent')
ok(/COMMIT;\s*NOTIFY pgrst, 'reload schema';\s*$/.test(sql.trim() + '\n'.trim()) || /NOTIFY pgrst, 'reload schema';\s*$/.test(sql.trim()), '135 ends with NOTIFY pgrst')
const migs = fs.readdirSync('db/migrations').filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
ok(migs.includes('135_preapproval_portal.sql') && migs[migs.length - 1] === '136_handoff_contacts.sql', '135 is there; 136 (contacts) is the highest migration')
const sql136 = stripSqlComments(read('db/migrations/136_handoff_contacts.sql'))
ok(/ADD COLUMN IF NOT EXISTS handoff_contacts jsonb NOT NULL DEFAULT '\[\]'::jsonb/.test(sql136) && /NOTIFY pgrst, 'reload schema';\s*$/.test(sql136.trim()), '136 adds handoff_contacts idempotently and ends with NOTIFY')
ok(!/\banon\b|GRANT\b|POLICY\b/i.test(sql136), '136 grants nothing and adds no policy (rides the projects policy)')

const routeDir = 'app/api/p/[token]'
const routes = fs.readdirSync(routeDir).map((d) => path.join(routeDir, d, 'route.ts'))
ok(eq(routes.map((r) => path.basename(path.dirname(r))).sort(), ['approve', 'contact', 'photo', 'question', 'request-change']), 'the five portal write routes exist')
for (const r of routes) {
  const src = stripTsComments(read(r))
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort()
  ok(eq(imports, ['@/lib/preapproval-portal', 'next/server']), `${r}: imports only next/server + the service-role lib`)
  ok(!/supabase|anon/i.test(src), `${r}: no database client of its own`)
  ok(!/export async function GET/.test(src), `${r}: no public GET to enumerate`)
}
const publicFiles = [
  'app/(preapproval)/p/[token]/page.tsx',
  'components/preapproval/PreapprovalPortalLive.tsx',
  'components/preapproval/PreapprovalPortalView.tsx',
  'lib/preapproval-view.ts',
  'lib/approval-kind.ts',
]
for (const f of publicFiles) {
  const src = stripTsComments(read(f))
  ok(!/from '(@\/lib|\.)\/supabase'/.test(src) && !/ANON_KEY|createClient/.test(src), `${f}: never touches the browser Supabase client / anon key`)
  ok(!/from '@\/lib\/(approvals|project-events|handoff|tasks|preapproval-admin)'/.test(src), `${f}: imports no RLS-path lib`)
}
const serverSrc = stripTsComments(read('lib/preapproval-portal.ts'))
ok(/import \{ supabaseAdmin \} from '\.\/supabase-admin'/.test(serverSrc) && !/from '\.\/supabase'/.test(serverSrc), 'the portal lib runs on the service role only')
const page = read('app/(preapproval)/p/[token]/page.tsx')
ok(/loadPreapprovalPortal\(token\)/.test(page) && /if \(!p\) notFound\(\)/.test(page), 'no token match → plain 404')
ok(/robots: \{ index: false, follow: false \}/.test(page), 'the portal is noindex')

console.log('⛔ TWO — every column the portal selects')
ok(!/select\(\s*['"`]\*['"`]/.test(serverSrc) && !/select\(\s*\)/.test(serverSrc), 'no select(*) anywhere in the portal lib')
const BANNED_COL = /\b(bid_total|\w*margin\w*|\w*cost\w*|\w*price\w*|\w*_rate|shop_rate|\w*hours\w*|\w*payment\w*|\w*deposit\w*|\w*invoice\w*|internal_notes|site_access_notes|net_change|annual_comp|stripe\w*|plan|plan_status|estimate\w*|dismissed_by|actor_user_id|uploaded_by_user_id|locked_\w+)\b/
const colLists = [
  ...[...serverSrc.matchAll(/const (\w+_COLS)\s*=\s*\n?\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
  ...[...serverSrc.matchAll(/\.select\(\s*\n?\s*'([^']+)'/g)].map((m) => ['select', m[1]]),
]
ok(colLists.length >= 14, `found the portal lib's column lists (${colLists.length})`)
for (const [name, cols] of colLists) {
  const hit = cols.split(',').map((c) => c.trim()).filter((c) => BANNED_COL.test(c))
  ok(hit.length === 0, `${name} "${cols.slice(0, 40)}…" selects nothing forbidden${hit.length ? ` — ${hit.join(', ')}` : ''}`)
}
ok(/const ITEM_COLS =\s*\n?\s*'id, subproject_id, label, material, finish, state, ball_in_court, last_state_change_at, item_kind, link_url, created_at'/.test(serverSrc), 'approval_items: display columns only (no custom_* baselines)')
ok(/\.in\('event_type', \[\.\.\.PORTAL_EVENT_TYPES\]\)/.test(serverSrc) && eq([...view.PORTAL_EVENT_TYPES], ['portal_contact_edit', 'portal_opened']), 'project_events: only the portal’s own event types are read')
ok(/answered_by_label: q\.answered_by && pm\.userId && q\.answered_by === pm\.userId \? pmFirst : null/.test(serverSrc), 'an answer is credited to the PM or the shop — never another teammate')
ok(/createSignedUrls\(paths, SIGNED_URL_SECONDS\)/.test(serverSrc) && !/getPublicUrl/.test(serverSrc), 'photos leave as short-lived signed URLs, never public ones')
const viewSrc = read('components/preapproval/PreapprovalPortalView.tsx')
// A literal dollar sign in front of a value (`$${x}`, >$1,200<, '$') or a
// currency formatter is what money on this page would have to look like.
ok(!/\$\$\{|>\s*\$|'\$'|"\$"|\$\d/.test(stripTsComments(viewSrc)) && !/fmtMoney|currency|toFixed\(2\)/.test(viewSrc), 'the page has no money formatting at all')

// ── STATIC — it's wired ─────────────────────────────────────────────────────
console.log('STATIC — approve / change / question / contact do what the spec says')
ok(/actor_name: name,/.test(serverSrc) && /from\('item_revisions'\)\.insert\(\{\s*approval_item_id: itemId,\s*action: to\.action,\s*note,\s*actor_user_id: null,\s*actor_name: name,/.test(serverSrc), 'approve writes the item_revisions row with the TYPED NAME')
ok(/from\('approval_items'\)\.update\(patch\)\.eq\('id', itemId\)\.select\('id'\)/.test(serverSrc) && /if \(!updated \|\| updated\.length === 0\) return failed\('Nothing was updated'\)/.test(serverSrc), 'the state update selects back; zero rows = failure')
ok(/if \(!isUsablePortalName\(name\)\) return bad\('Type your name to approve'\)/.test(serverSrc), 'approve REQUIRES a typed name')
ok(/if \(item\.ball_in_court !== 'client'\) return conflict/.test(serverSrc), 'a stale tab can’t approve what the shop pulled back')
ok(/draftCoItemIds\(\[item\.id\]\)\)\.has\(item\.id\)\) return conflict/.test(serverSrc), '⛔ the priced-change guard is enforced server-side')
ok(!/finalizeSpecCosOnApproval/.test(serverSrc), 'a portal approval never finalizes a change order')
ok(/\{ state: 'approved', ball: null, action: 'approved' \}/.test(serverSrc) && /\{ state: 'pending', ball: 'shop', action: 'client_requested_change' \}/.test(serverSrc), 'approve / request-change use the app’s own transitions')
ok(/if \(note\.length < 3\) return bad\('Tell us what to change'\)/.test(serverSrc), 'a change request REQUIRES a note')
ok(/update\(\{ state: 'approved', responded_at: now, responded_by_name: name, updated_at: now \}\)[\s\S]{0,160}\.eq\('is_latest', true\)\s*\.eq\('state', 'in_review'\)\s*\.select\('id'\)/.test(serverSrc), 'a drawing approval is signed, latest-only, and selects back')
ok(/linked_to_item_id', itemId\)/.test(serverSrc), 'linked slots mirror, same as the in-app path')
ok(/from\('portal_questions'\)\s*\.insert\(\{ org_id: id\.orgId, project_id: id\.projectId, body: text, author_name: name \}\)/.test(serverSrc), 'a question inserts with its author')
ok(/from\('tasks'\)\s*\.insert\(\{[\s\S]*?title: `Portal question — \$\{id\.projectName\}`[\s\S]*?assignee_ids: pm\.rosterId \? \[pm\.rosterId\] : \[\][\s\S]*?tags: \[PORTAL_QUESTION_TAG\]/.test(serverSrc) && server.PORTAL_QUESTION_TAG === 'PM Communication', 'the question ALSO creates the "PM Communication" task for the PM, on the project')
ok(/project_id: id\.projectId,\s*title: `Portal question/.test(serverSrc), 'the task is linked to the project')
ok(/update\(\{ task_id: \(task as \{ id: string \}\)\.id \}\)/.test(serverSrc), 'the question remembers its task (so the thread can close it)')
ok(/event_type: 'portal_contact_edit'/.test(serverSrc) && /contactChanges\(current, body\?\.fields\)/.test(serverSrc), 'a contact edit goes through the allowlist and logs a project_event')
ok(/preprod_coordinator/.test(serverSrc) && /\^kaylin\\b/i.test(serverSrc) && /eq\('role', 'owner'\)/.test(serverSrc), 'the PM resolves: coordinator → PM title → Kaylin → owner')
ok(/\.is\('practice_at', null\)\s*\.in\('stage', PORTAL_STAGES\)/.test(serverSrc), 'practice / unsold / lost projects have no portal')

console.log('STATIC — /p is reserved, public, and the old portal is untouched')
ok(/^\s*'p',$/m.test(read('lib/reserved-slugs.ts')), "'p' is in RESERVED_SLUGS")
ok(/pathname\.startsWith\('\/p\/'\)/.test(read('lib/auth-context.tsx')), '/p/ is a public path (no login bounce)')
try {
  ok(/PASS/.test(execSync('node scripts/verify-reserved-slugs.mjs', { encoding: 'utf8' })), 'verify-reserved-slugs passes')
} catch {
  ok(false, 'verify-reserved-slugs passes')
}

console.log('STATIC — the pre-production side')
const slots = read('components/approval-slots.tsx')
ok(/ITEM_KINDS\.map\(\(k\) => \(/.test(slots) && /onClick=\{\(\) => setPicked\(k\)\}/.test(slots), '1 · the add-callout form has the TYPE picker')
ok(/item_kind: v\.kind,/.test(slots) && /groupByKind\(items\)\.map/.test(slots), '1 · the picker writes item_kind and the list regroups by kind')
ok(/kind === 'hardware' \|\| v\.link\.trim\(\)/.test(slots) && /<SlotPhotos itemId=\{item\.id\} \/>/.test(slots), '2 · the slot editor has the photo uploader + the hardware link')
const approvalsLib = read('lib/approvals.ts')
ok(/item_kind: input\.item_kind \? normalizeItemKind\(input\.item_kind\) : guessItemKind\(input\)/.test(approvalsLib) && /item_kind: guessItemKind\(p\),/.test(approvalsLib), 'new callouts — typed or seeded — always get a kind')
const card = read('components/preapproval/PortalAdminCard.tsx')
ok(/answerPortalQuestion\(q\.id, text, userId \?\? null\)/.test(card) && /data-unanswered-badge/.test(card) && /setTaskDone\(q\.task_id, true/.test(card), '3 · questions thread: badge, answer, close the task')
const adminSrc = read('lib/preapproval-admin.ts')
ok(/update\(\{ answer: text, answered_by: userId, answered_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\('id', questionId\)\s*\.select\('id'\)/.test(adminSrc) && /if \(!data \|\| data\.length === 0\) throw new Error\('The answer could not be saved\.'\)/.test(adminSrc), '3 · an answer writes answer/answered_by/answered_at and selects back')
ok(/data-lead-time/.test(card) && /update\(\{ lead_time_weeks: weeks \}\)\s*\.eq\('id', projectId\)\s*\.select\('id'\)/.test(adminSrc), '4 · the lead-time field saves (and selects back)')
ok(/Create portal link/.test(card) && /Copy link/.test(card) && /title: 'Reissue the portal link\?'/.test(card), '5 · create / copy / reissue (reissue asks first)')
const adminRoute = read('app/api/preapproval/[projectId]/route.ts')
ok(/resolveApiCaller\(req\)/.test(adminRoute) && /\.eq\('org_id', orgId\)/.test(adminRoute) && /mintProjectPortalToken\(\)/.test(adminRoute), '5 · the link is minted server-side, for the caller’s own org only')
ok(/if \(!project\.portal_token\) patch =/.test(adminRoute), '5 · asking for the link never rotates an existing one')
ok(/href=\{mailtoHref\(state\.pocEmail, state\.email\)\}/.test(card) && /onClick=\{\(\) => void act\('notified'\)\}/.test(card) && /patch = \{ portal_last_notified_at: now \}/.test(adminRoute), '6 · one click opens the prefilled mailto and stamps the queue cleared')
const newFiles = execSync('git ls-files --others --modified --exclude-standard -- lib app components', { encoding: 'utf8' }).split('\n').filter(Boolean)
const senders = newFiles.filter((f) => /\.(ts|tsx)$/.test(f) && /nodemailer|resend|sendgrid|postmark|smtp|klaviyo/i.test(stripTsComments(read(f))))
ok(senders.length === 0, `6 · NOTHING auto-sends — no mail library in the changed files${senders.length ? ` (${senders.join(', ')})` : ''}`)
const pre = read('app/(app)/projects/[id]/pre-production/page.tsx')
ok(/<PortalAdminCard projectId=\{projectId\}/.test(pre), 'the card is mounted on the pre-production page')
const photoRoute = read('app/api/preapproval/photos/route.ts')
ok((photoRoute.match(/resolveApiCaller\(req\)/g) || []).length === 3 && /\.eq\('org_id', orgId\)/.test(photoRoute) && /\.eq\('org_id', caller\.orgId\)/.test(photoRoute), 'the shop’s photo route is authenticated + org-checked on GET, POST and DELETE')
ok(/process\.env\.NODE_ENV === 'production'\) notFound\(\)/.test(read('app/dev/preapproval-portal/page.tsx')), 'the dev fixture 404s in production')

console.log(failures === 0 ? `\nPASS — ${checks} checks.` : `\nFAIL — ${failures} of ${checks} checks failed.`)
process.exit(failures === 0 ? 0 : 1)
