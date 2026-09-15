// ============================================================================
// verify-import-freeze.mjs — who gets frozen, and what a mixed project costs.
// ============================================================================
// Run: npx tsx scripts/verify-import-freeze.mjs
//
// ⛔ WHY THIS MATTERS. The import freeze says "this row's stored cost IS its
// price — add no labor $, no consumables, no margin." It was keyed on
// `projects.imported_at`, so it also caught scope added AFTER the import: a
// change order's new room, with real composer lines and real hours, priced at
// material cost with nothing on top. Migration 108 moves the freeze onto the
// subproject.
//
// Two things have to hold, and money moves the wrong way if either slips:
//   1. The FALLBACK DIRECTION. A caller that forgets to select `price_frozen`
//      must still get the old frozen answer on an imported job. Failing open
//      re-prices a signed contract and marks it up a second time.
//   2. A MIXED project must price its halves separately. One bucket sum
//      through one margin either bills Built's rooms twice or gives away the
//      margin on the new work.
// ============================================================================

import {
  addBuckets,
  computeBucketedPrice,
  effectiveConsumablePct,
  effectiveShopRate,
  emptyBuckets,
  isSubFrozen,
  priceMixedBuckets,
  resolveBucketMargins,
  resolveMarginsForNewScope,
} from '../lib/pricing.ts'

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

const IMPORTED = { imported_at: '2026-07-30T00:00:00Z', locked_shop_rate: 85 }
const NATIVE = { imported_at: null, locked_shop_rate: 95 }

// ── Who is frozen ───────────────────────────────────────────────────────────
console.log('\nwho is frozen')
check('a migrated room', isSubFrozen(IMPORTED, { price_frozen: true }), true)
// ⛔ THE WHOLE POINT OF 108: new scope on an imported job is NOT frozen.
check('new scope on an imported job', isSubFrozen(IMPORTED, { price_frozen: false }), false)
check('any sub on a native job', isSubFrozen(NATIVE, { price_frozen: false }), false)
// ⛔ THE FALLBACK DIRECTION. undefined = "the caller didn't ask for the
// column", and that must resolve to the OLD project-level answer. Failing the
// other way silently re-prices a signed contract.
check('column not selected, imported job ⇒ FROZEN', isSubFrozen(IMPORTED, {}), true)
check('column not selected, native job ⇒ live', isSubFrozen(NATIVE, {}), false)
check('no sub at all, imported job ⇒ FROZEN', isSubFrozen(IMPORTED, null), true)
check('null column ⇒ treated as not selected', isSubFrozen(IMPORTED, { price_frozen: null }), true)
// false is an EXPLICIT answer and outranks the project.
check('explicit false beats imported_at', isSubFrozen(IMPORTED, { price_frozen: false }), false)

// ── Rate + consumables follow the same rule ─────────────────────────────────
console.log('\nrate and consumables')
check('frozen sub ⇒ rate 0', effectiveShopRate(IMPORTED, 120, { price_frozen: true }), 0)
check('live sub on an imported job ⇒ the locked rate', effectiveShopRate(IMPORTED, 120, { price_frozen: false }), 85)
check('no sub passed ⇒ old answer (0)', effectiveShopRate(IMPORTED, 120), 0)
check('native ⇒ locked rate wins over org', effectiveShopRate(NATIVE, 120, { price_frozen: false }), 95)
check('frozen ⇒ consumables 0', effectiveConsumablePct(IMPORTED, 10, 15, { price_frozen: true }), 0)
check('live on imported ⇒ sub pct wins', effectiveConsumablePct(IMPORTED, 10, 15, { price_frozen: false }), 15)
check('live, no sub pct ⇒ org pct', effectiveConsumablePct(IMPORTED, 10, null, { price_frozen: false }), 10)

// ── The margin half of the freeze ───────────────────────────────────────────
console.log('\nmargins for new scope')
// The importer pins every project margin to 0 to freeze Built's numbers. Fix
// only the rate and a change order still prices at raw COST.
const IMPORTED_PINNED = { ...IMPORTED, labor_margin_pct: 0, material_margin_pct: 0, consumable_margin_pct: 0 }
const ORG = { labor_margin_pct: 40, material_margin_pct: 30, consumable_margin_pct: 20 }
check('the plain resolver still returns the frozen zeros', resolveBucketMargins(IMPORTED_PINNED, ORG), {
  laborMarginPct: 0,
  materialMarginPct: 0,
  consumableMarginPct: 0,
})
check('new scope ignores the importer pins and uses the org', resolveMarginsForNewScope(IMPORTED_PINNED, ORG), {
  laborMarginPct: 40,
  materialMarginPct: 30,
  consumableMarginPct: 20,
})
// ⚠️ A NATIVE project's pins are a real decision and must survive.
const NATIVE_PINNED = { ...NATIVE, labor_margin_pct: 50, material_margin_pct: 50, consumable_margin_pct: 50 }
check('a native project keeps its own pins', resolveMarginsForNewScope(NATIVE_PINNED, ORG), {
  laborMarginPct: 50,
  materialMarginPct: 50,
  consumableMarginPct: 50,
})
check('no pins anywhere ⇒ the 35 default', resolveMarginsForNewScope(NATIVE, null), {
  laborMarginPct: 35,
  materialMarginPct: 35,
  consumableMarginPct: 35,
})

// ── A mixed project ─────────────────────────────────────────────────────────
console.log('\na mixed project prices its halves separately')
const MARGINS = { laborMarginPct: 50, materialMarginPct: 50, consumableMarginPct: 50 }
// Built's migrated room: $10,000 sitting in the material lump, no hours priced.
const frozenHalf = { ...emptyBuckets(), materialCost: 10_000 }
// A change order's new room: $1,000 labor + $1,000 material of real cost.
const liveHalf = { ...emptyBuckets(), laborCost: 1_000, materialCost: 1_000 }

const mixed = priceMixedBuckets(frozenHalf, liveHalf, MARGINS)
// Frozen passes through at cost; live doubles at a 50% gross margin.
check('frozen half is untouched', mixed.frozenPrice, 10_000)
check('live half carries the margin', mixed.livePrice, 4_000)
check('total', mixed.priceTotal, 14_000)

// ⛔ THE BUG THIS REPLACES, stated as a number. One sum through one margin:
const naiveAllMargin = computeBucketedPrice(
  { ...emptyBuckets(), laborCost: 1_000, materialCost: 11_000 },
  MARGINS,
).priceTotal
check('one-sum-with-margin would bill Built twice', naiveAllMargin, 24_000)
const naiveNoMargin = computeBucketedPrice(
  { ...emptyBuckets(), laborCost: 1_000, materialCost: 11_000 },
  { laborMarginPct: 0, materialMarginPct: 0, consumableMarginPct: 0 },
).priceTotal
// This is what shipped before 108: the change order's $4,000 of work billed at
// $2,000 of cost. The $2,000 gap is the margin, given away silently.
check('one-sum-frozen gives the change order away', naiveNoMargin, 12_000)
check('the fix sits between the two failures', mixed.priceTotal, 14_000)

// ── The split is EXACT, not an approximation ────────────────────────────────
console.log('\nsplitting is exact')
// priceFromMargin is linear in cost, so when both halves share a margin the
// split must equal a single pass. If this ever fails, the two code paths that
// price a project have silently diverged.
const a = { ...emptyBuckets(), laborCost: 1234.56, materialCost: 789.01, consumablesCost: 45.67 }
const b = { ...emptyBuckets(), laborCost: 987.65, materialCost: 432.1, consumablesCost: 8.9 }
const together = computeBucketedPrice(
  {
    ...emptyBuckets(),
    laborCost: a.laborCost + b.laborCost,
    materialCost: a.materialCost + b.materialCost,
    consumablesCost: a.consumablesCost + b.consumablesCost,
  },
  MARGINS,
).priceTotal
const apart =
  computeBucketedPrice(a, MARGINS).priceTotal + computeBucketedPrice(b, MARGINS).priceTotal
check('same margin ⇒ split == single pass', Math.abs(together - apart) < 0.01, true)

// ── addBuckets ──────────────────────────────────────────────────────────────
console.log('\nbucket accumulation')
const acc = emptyBuckets()
addBuckets(acc, { laborCost: 10, materialCost: 20 })
addBuckets(acc, { laborCost: 5, customCost: 1 })
check('adds into the accumulator', acc, {
  laborCost: 15,
  materialCost: 20,
  hardwareCost: 0,
  consumablesCost: 0,
  installCost: 0,
  optionsCost: 0,
  customCost: 1,
})
// A rollup object carries extra keys (hoursByDept, subtotal…). They must not
// leak into the buckets — callers spread whole rollups into this.
addBuckets(acc, { laborCost: 1, hoursByDept: { eng: 99 }, subtotal: 999 })
check('ignores keys that are not buckets', acc.laborCost, 16)
check('and adds nothing else', Object.keys(acc).length, 7)

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
