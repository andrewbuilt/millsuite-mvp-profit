// ============================================================================
// verify-bom-merge.mjs — what a re-parse is allowed to touch.
// ============================================================================
// Run: npx tsx scripts/verify-bom-merge.mjs
//
// ⛔ THE RULE UNDER TEST (Andrew, 2026-09-12): "re-parse appends new finds and
// flags count differences — it never overwrites or deletes edited rows."
//
// This is the part of the BOM that can destroy work silently. The task-system
// merge bug is the precedent: a field missing from an allowlist was reverted
// on every save, the indicator said "saved", and nothing surfaced it.
// ============================================================================

import {
  bomKey,
  hasCountDisagreement,
  mergeParsedBom,
} from '../lib/bom-merge.ts'

let pass = 0
let fail = 0

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else {
    fail++
    console.log(`  ❌ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
}

const row = (over = {}) => ({
  id: 'r1',
  category: 'sheet_good',
  name: '3/4 White Oak veneer core',
  spec: '4x8',
  qty: 12,
  parsedQty: 12,
  unit: 'sheets',
  source: 'parsed',
  checkedOff: false,
  notes: null,
  ...over,
})

const parsed = (over = {}) => ({
  category: 'sheet_good',
  name: '3/4 White Oak veneer core',
  spec: '4x8',
  qty: 12,
  unit: 'sheets',
  notes: null,
  ...over,
})

// ── A second parse of the same set must not duplicate anything ────────────
{
  const plan = mergeParsedBom([row()], [parsed()])
  check('no inserts', plan.inserts.length, 0)
  check('no flags', plan.flags.length, 0)
  check('counted as unchanged', plan.unchanged, 1)
}

// ── New finds append ──────────────────────────────────────────────────────
{
  const plan = mergeParsedBom(
    [row()],
    [parsed(), parsed({ category: 'hardware', name: 'Blum 21in soft-close slide', spec: null, qty: 24, unit: 'pr' })],
  )
  check('one insert', plan.inserts.length, 1)
  check('the right one', plan.inserts[0].name, 'Blum 21in soft-close slide')
  check('existing left alone', plan.flags.length, 0)
}

// ── ⛔ THE ONE THAT MATTERS: a human edit survives a re-parse ─────────────
// Shop counted 14 by hand where the parser said 12. The drawings still say
// 12. The correction must stand, and nothing may be written.
{
  const edited = row({ qty: 14, parsedQty: 12, checkedOff: true, notes: 'counted on site' })
  const plan = mergeParsedBom([edited], [parsed({ qty: 12 })])
  check('nothing inserted', plan.inserts.length, 0)
  check('nothing flagged — parser has not changed its mind', plan.flags.length, 0)

  // ⛔ The structural guarantee: there is no way to express a qty write.
  const planKeys = Object.keys(plan).sort()
  check('the plan can only insert and flag', planKeys, ['flags', 'inserts', 'unchanged'])
  const flagShape = Object.keys(mergeParsedBom([row()], [parsed({ qty: 99 })]).flags[0]).sort()
  check('a flag carries ONLY id + parsedQty', flagShape, ['id', 'parsedQty'])
}

// ── The drawings genuinely changed ⇒ flag, don't apply ────────────────────
{
  const edited = row({ qty: 14, parsedQty: 12 })
  const plan = mergeParsedBom([edited], [parsed({ qty: 18 })])
  check('flagged', plan.flags.length, 1)
  check('flag targets the row', plan.flags[0].id, 'r1')
  check('flag carries the PARSER number', plan.flags[0].parsedQty, 18)
  // And crucially the human's 14 is nowhere in the plan — there is nothing
  // to write it with.
  check('no insert either', plan.inserts.length, 0)
}

// ── ⛔ A corrected row must not re-flag on every parse ────────────────────
// Compare against what the parser said LAST time, not against the human's
// number — otherwise the flag degrades into "somebody edited this".
{
  const corrected = row({ qty: 14, parsedQty: 12 })
  const first = mergeParsedBom([corrected], [parsed({ qty: 12 })])
  check('quiet on an unchanged re-parse', first.flags.length, 0)

  const secondTime = mergeParsedBom([corrected], [parsed({ qty: 12 })])
  check('still quiet the third time', secondTime.flags.length, 0)
}

// ── A hand-added row the parser then finds ────────────────────────────────
{
  const manual = row({ source: 'manual', parsedQty: null, qty: 5 })
  const plan = mergeParsedBom([manual], [parsed({ qty: 5 })])
  check('matched, not duplicated', plan.inserts.length, 0)
  // parsedQty was null, so the parser's opinion is news — record it.
  check('parser opinion recorded', plan.flags.length, 1)
  check('and it is the parser count', plan.flags[0].parsedQty, 5)
}

// ── ⛔ NOTHING IS EVER DELETED ────────────────────────────────────────────
// A row the parser stopped seeing stays. The parser missing something is at
// least as likely as the drawings changing, and the shop may have ordered.
{
  const plan = mergeParsedBom([row(), row({ id: 'r2', name: 'Baltic birch 1/2' })], [])
  check('empty parse inserts nothing', plan.inserts.length, 0)
  check('and flags nothing', plan.flags.length, 0)
  check('the plan has no delete channel at all', 'deletes' in plan, false)
}

// ── Key normalisation ─────────────────────────────────────────────────────
{
  check(
    'case and spacing collapse',
    bomKey('sheet_good', '3/4  WHITE oak', '4x8'),
    bomKey('sheet_good', '3/4 White Oak', '4x8'),
  )
  check(
    'drifting punctuation collapses',
    bomKey('sheet_good', '3/4in. white oak', null),
    bomKey('sheet_good', '3/4in white oak', ''),
  )
  // ⚠️ But NOT fuzzy: different sizes are different things to buy. Merging
  // them would lose a count with no trace.
  const a = bomKey('hardware', 'Blum 21in slide', null)
  const b = bomKey('hardware', 'Blum 18in slide', null)
  check('different sizes stay separate', a === b, false)
  check('category separates too', bomKey('hardware', 'x', null) === bomKey('other', 'x', null), false)
}

// ── A parser that repeats itself inside one response ──────────────────────
{
  const plan = mergeParsedBom([], [parsed(), parsed(), parsed({ qty: 3 })])
  check('deduped within the response', plan.inserts.length, 1)
}

// ── hasCountDisagreement ──────────────────────────────────────────────────
{
  check('agrees', hasCountDisagreement(row({ qty: 12, parsedQty: 12 })), false)
  check('disagrees', hasCountDisagreement(row({ qty: 14, parsedQty: 12 })), true)
  check('no parser opinion ⇒ no disagreement', hasCountDisagreement(row({ parsedQty: null })), false)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
