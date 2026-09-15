// ============================================================================
// verify-co-docs.mjs — change orders v2: the rules, pinned.
// ============================================================================
// Run: npx tsx scripts/verify-co-docs.mjs
//
// ⛔ WHY THIS MATTERS. A change order is a signed document. The numbering has
// to be stable (the client was shown "CO-02" once and it can never mean a
// different document), the money has to be a plain sum with the sign living in
// the row, and a doc must not be acceptable while it's empty or while a draft
// has no lines — accepting either burns a CO number on a document that says
// nothing, or materialises a $0 subproject onto the production schedule.
//
// The other half is `composerLineRow`: the draft's price and the price after
// acceptance have to come from ONE function over ONE payload, because if they
// can drift the client signs a number the contract total never moves by.
// ============================================================================

import {
  canAcceptDoc,
  canTouchSubproject,
  coLabel,
  docDelta,
  itemHeadline,
  nextCoNumber,
  nextItemOrder,
  summarizeDoc,
} from '../lib/co-doc-math.ts'
import { breakdownToStorageValues, composerLineRow } from '../lib/composer-row.ts'

let pass = 0
let fail = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else {
    fail++
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
  }
}

// ── Numbering ───────────────────────────────────────────────────────────────
console.log('\nnumbering')
check('first CO is 1', nextCoNumber([]), 1)
check('after CO-01', nextCoNumber([{ number: 1 }]), 2)
// ⛔ THE ONE THAT MATTERS: a voided doc keeps its number. Counting live docs
// would hand CO-02 to a second, different document.
check('voided numbers are never reused', nextCoNumber([{ number: 1 }, { number: 2 }]), 3)
check('out of order', nextCoNumber([{ number: 3 }, { number: 1 }]), 4)
check('null numbers ignored', nextCoNumber([{ number: null }, { number: 2 }]), 3)
check('label pads', coLabel({ number: 2 }), 'CO-02')
check('label two digits', coLabel({ number: 12 }), 'CO-12')

// ── Item ordering ───────────────────────────────────────────────────────────
console.log('\nitem order')
check('first item', nextItemOrder([]), 0)
check('max + 1', nextItemOrder([{ sort_order: 0 }, { sort_order: 4 }]), 5)
check('deleted slots are not reused', nextItemOrder([{ sort_order: 7 }]), 8)

// ── Money ───────────────────────────────────────────────────────────────────
console.log('\nmoney')
check('empty doc is $0', docDelta([]), 0)
check('one addition', docDelta([{ delta_amount: 4000 }]), 4000)
// A doc that adds $4,000 and credits $1,500 is a $2,500 change order — one
// number, one signature.
check('add + credit nets', docDelta([{ delta_amount: 4000 }, { delta_amount: -1500 }]), 2500)
check('credit-only doc is negative', docDelta([{ delta_amount: -1500 }]), -1500)
check('garbage counts as zero', docDelta([{ delta_amount: null }, { delta_amount: 100 }]), 100)

const mixed = [
  { kind: 'add_sub', delta_amount: 4000, subproject_id: null },
  { kind: 'remove_sub', delta_amount: -1500, subproject_id: 's1' },
  { kind: 'edit_sub', delta_amount: 250, subproject_id: 's2' },
]
check('summary', summarizeDoc(mixed), {
  adds: 1,
  edits: 1,
  removes: 1,
  delta: 2750,
  additions: 4250,
  credits: -1500,
})

// ── Acceptance gates ────────────────────────────────────────────────────────
console.log('\nacceptance gates')
const openDoc = { status: 'open' }
const goodDraft = {
  kind: 'add_sub',
  subproject_id: null,
  draft: { name: 'Island', lines: [{ key: 'a' }] },
  delta_amount: 4000,
}

check('a full doc accepts', canAcceptDoc(openDoc, [goodDraft]).ok, true)
// ⛔ `ensureOpenDoc` creates a doc on the first click, so an abandoned click
// leaves an empty open doc. Accepting it stamps a signature against no scope.
check('an EMPTY doc cannot be accepted', canAcceptDoc(openDoc, []).ok, false)
check('an already-accepted doc cannot be re-accepted', canAcceptDoc({ status: 'accepted' }, [goodDraft]).ok, false)
check('a voided doc cannot be accepted', canAcceptDoc({ status: 'void' }, [goodDraft]).ok, false)
// ⛔ Materialises into a $0 subproject — a row on the production schedule with
// no work in it, which reads as "somebody forgot to finish this" forever.
check(
  'a draft with NO LINES cannot be accepted',
  canAcceptDoc(openDoc, [{ ...goodDraft, draft: { name: 'Island', lines: [] } }]).ok,
  false,
)
check(
  'a nameless draft cannot be accepted',
  canAcceptDoc(openDoc, [{ ...goodDraft, draft: { name: '  ', lines: [{ key: 'a' }] } }]).ok,
  false,
)
check(
  'a removal with no subproject cannot be accepted',
  canAcceptDoc(openDoc, [{ kind: 'remove_sub', subproject_id: null, draft: {}, delta_amount: -1 }]).ok,
  false,
)
check(
  'the refusal names the draft',
  canAcceptDoc(openDoc, [{ ...goodDraft, draft: { name: 'Island', lines: [] } }]).reason.includes('Island'),
  true,
)

// ── One item per subproject per doc ─────────────────────────────────────────
console.log('\none item per subproject')
const items = [{ kind: 'remove_sub', subproject_id: 's1' }, { kind: 'edit_sub', subproject_id: 's2' }]
check('an untouched sub is free', canTouchSubproject(items, 's3').ok, true)
check('a sub already being removed is not', canTouchSubproject(items, 's1').ok, false)
check('a sub already being edited is not', canTouchSubproject(items, 's2').ok, false)
check('and it says which', canTouchSubproject(items, 's1').reason.includes('removed'), true)

// ── Display ─────────────────────────────────────────────────────────────────
console.log('\nheadlines')
check('typed description wins', itemHeadline({ kind: 'add_sub', description: 'Waterfall top', draft: {} }), 'Waterfall top')
check(
  'falls back to the draft name',
  itemHeadline({ kind: 'add_sub', description: '  ', draft: { name: 'Island' } }),
  'Add Island',
)
check('removal names the sub', itemHeadline({ kind: 'remove_sub', description: null, draft: {} }, 'Pantry'), 'Remove Pantry')

// ── The storage contract ────────────────────────────────────────────────────
console.log('\ncomposer storage contract (per-unit)')
// ⛔ computeBreakdown returns WHOLE-LINE totals; the columns are PER-UNIT.
// Issue 18 was 8× labor on round-trip because one caller forgot.
const breakdown = {
  hoursByDept: { eng: 2, cnc: 4, assembly: 8, finish: 0, install: 0 },
  materialSubtotal: 800,
  waste: 40,
}
check('hours divide by qty', breakdownToStorageValues(breakdown, 4).deptHourOverrides, {
  eng: 0.5,
  cnc: 1,
  assembly: 2,
})
check('zero depts are omitted, not stored as 0', 'finish' in (breakdownToStorageValues(breakdown, 4).deptHourOverrides ?? {}), false)
check('material is per-unit and includes waste', breakdownToStorageValues(breakdown, 4).lumpCostOverride, 210)
check(
  'no hours at all ⇒ null, not {}',
  breakdownToStorageValues({ hoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 }, materialSubtotal: 0, waste: 0 }, 1)
    .deptHourOverrides,
  null,
)
// qty 0 must not divide by zero and produce Infinity in a money column.
check('qty 0 is safe', breakdownToStorageValues(breakdown, 0), { deptHourOverrides: null, lumpCostOverride: 0 })

// ── The invariant CO v2 rests on ────────────────────────────────────────────
console.log('\ndraft payload == materialised payload')
// An empty rate book: `summarizeSlots` looks every slot up by id, and with
// nothing picked the description falls back to the bare product label. That's
// enough to pin the STORAGE columns, which is what acceptance re-inserts.
const rateBook = {
  materials: [],
  doorTypes: [],
  doorTypeMaterials: [],
  doorTypeMaterialFinishes: [],
  drawerStyles: [],
  finishes: [],
  features: [],
  customProducts: [],
  solidWoodComponents: [],
}
const draft = { productId: 'base', qty: 4, slots: { notes: 'CO scope' } }
const row = composerLineRow({ draft, breakdown, rateBook })
// ⛔ THIS IS THE WHOLE POINT. The row priced as a draft is the row inserted on
// acceptance — same object, not a re-derivation. If these two ever diverge the
// client signs a number the contract total never moves by.
check('lump matches the storage contract', row.lump_cost_override, 210)
check('hours match the storage contract', row.dept_hour_overrides, { eng: 0.5, cnc: 1, assembly: 2 })
check('quantity is carried', row.quantity, 4)
check('composer lines have no rate book item', row.rate_book_item_id, null)
check('material mode is lump', row.material_mode_override, 'lump')
check('notes come off the slots', row.notes, 'CO scope')
check('stamped as corrected', row.composer_hours_corrected, true)
check('product_key round-trips for edit', row.product_key, 'base')

// ── The inertness guard ─────────────────────────────────────────────────────
console.log('\ndrafts have exactly one data path')
// ⛔ THIS IS ANDREW'S CONDITION, ENFORCED RATHER THAN PROMISED.
//
// He blessed storing drafts as jsonb instead of flagged subprojects on one
// condition: they render as highlighted subs on the project page AND stay
// inert to bid_total, schedule, capacity and pre-production until acceptance.
//
// The inert half holds because a draft is NOT a `subprojects` row — the ~60
// places that read that table cannot see it, and none of them had to remember
// anything. That safety lasts exactly as long as `co_doc_items` has one
// reader. The day someone adds a second query somewhere, the doc-status filter
// becomes a thing to remember again, and "remember to filter in N places" is
// the failure this design exists to avoid.
//
// So: read the filesystem and refuse to pass if the tables are queried
// anywhere but the data layer. Same shape as verify-reserved-slugs and the
// CREATE TABLE scan in rls-audit — derived, so it cannot drift from what ships.
import fs from 'fs'
import path from 'path'

// ⚠️ THE ALLOWLIST IS THE POINT, NOT A LOOPHOLE. Every entry is a second
// reader somebody had to justify out loud, which is the decision this check
// exists to force.
//
//   · lib/co-docs.ts — the data layer. The browser's only path.
//   · the PDF route — CANNOT go through lib/co-docs: it runs server-side as
//     the SERVICE ROLE, which bypasses RLS entirely, while lib/co-docs uses
//     the anon client and relies on it. ⛔ So that route carries its own org
//     check against `co_docs.org_id`, and that check IS the security — there
//     is no policy behind it. Read it before adding anything beside it.
const ALLOWED = new Set(['lib/co-docs.ts', 'app/api/co-docs/[id]/pdf/route.ts'])
const roots = ['lib', 'app', 'components', 'scripts']
const offenders = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue
    const rel = full.split(path.sep).join('/')
    if (ALLOWED.has(rel)) continue
    const src = fs.readFileSync(full, 'utf8')
    // The query form only — a type import or a comment mentioning the table
    // is not a data path.
    if (/from\(\s*['"`]co_doc(s|_items)['"`]\s*\)/.test(src)) offenders.push(rel)
  }
}
for (const r of roots) if (fs.existsSync(r)) walk(r)

check('co_docs / co_doc_items are queried in lib/co-docs.ts only', offenders, [])
if (offenders.length > 0) {
  console.log(
    '\n   ⛔ A draft is only invisible to the rest of the app while it has ONE\n' +
      '   reader. Route this through lib/co-docs instead of querying directly.',
  )
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
