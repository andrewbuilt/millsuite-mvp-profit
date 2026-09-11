// ============================================================================
// scripts/verify-subproject-price.mjs — the sub prices must sum to the total
// ============================================================================
//   npx tsx scripts/verify-subproject-price.mjs
//
// Two properties, and the second is the one Andrew will actually check:
//
//   1. A subproject's PRICE is its cost through the same per-bucket margins
//      the project total uses. Because computeBucketedPrice is linear in every
//      bucket, the sum of the per-sub prices equals the project price exactly.
//      That linearity is the whole reason this is possible at all, so it is
//      asserted here rather than assumed — if someone ever adds a non-linear
//      term (a minimum, a cap, a tiered rate) these cases fail loudly instead
//      of the cards quietly drifting from the total.
//
//   2. Rounded to whole dollars, the cards STILL sum to the total. That needs
//      largest-remainder allocation; independent Math.round does not do it.
//
// Plus the case that matters most in this codebase: an IMPORTED job, whose
// margins are pinned to 0. Its card price must equal its cost exactly — a
// frozen job that displays a marked-up number is the bug that has already
// appeared on three other surfaces.
// ============================================================================

import { computeBucketedPrice } from '../lib/pricing.ts'
import { allocateRounded, allocationDrift } from '../lib/allocate.ts'

let bad = 0
const ck = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`)
}

const MARGINS = { laborMarginPct: 35, materialMarginPct: 20, consumableMarginPct: 10 }

/** A subproject's cost buckets, shaped like the project page builds them. */
const sub = (o = {}) => ({
  laborCost: 0,
  materialCost: 0,
  hardwareCost: 0,
  consumablesCost: 0,
  installCost: 0,
  optionsCost: 0,
  customCost: 0,
  ...o,
})

const sumBuckets = (subs) =>
  subs.reduce((a, s) => {
    for (const k of Object.keys(a)) a[k] += s[k]
    return a
  }, sub())

const priceOf = (b, margins = MARGINS) => computeBucketedPrice(b, margins).priceTotal

// ── 1. Linearity: the property everything else rests on ────────────────────
const SUBS = [
  sub({ laborCost: 4210.33, materialCost: 2880.11, hardwareCost: 190.5 }),
  sub({ laborCost: 999.99, materialCost: 1.01, consumablesCost: 77.77 }),
  sub({ laborCost: 12000, materialCost: 8000, installCost: 3400, customCost: 615.25 }),
  sub({ optionsCost: 333.33 }),
]

const projectPrice = priceOf(sumBuckets(SUBS))
const subPrices = SUBS.map((s) => priceOf(s))

// Within a cent: each computeBucketedPrice call rounds to 2dp, so four calls
// can differ from one call by a few hundredths. Anything larger means the
// function stopped being linear.
ck(
  'sum of sub prices == project price (linear)',
  allocationDrift(subPrices, projectPrice) < 0.05,
  true,
)

// ── 2. Rounded cards still sum to the rounded total ────────────────────────
const allocated = allocateRounded(subPrices, projectPrice)
ck(
  'allocated cards sum to the rounded project total',
  allocated.reduce((a, b) => a + b, 0),
  Math.round(projectPrice),
)

// And each card is still within a dollar of its true price — allocation moves
// pennies, it does not reprice anything.
ck(
  'every card stays within $1 of its true price',
  allocated.every((v, i) => Math.abs(v - subPrices[i]) < 1),
  true,
)

// The naive approach must actually be broken, or this whole module is
// pointless. This is the case from the header.
const NAIVE = [1000.4, 1000.4, 1000.4]
const naiveTotal = 3001.2
ck(
  'independent rounding really does miss (why we need this)',
  NAIVE.map(Math.round).reduce((a, b) => a + b, 0) === Math.round(naiveTotal),
  false,
)
ck(
  'allocation fixes exactly that case',
  allocateRounded(NAIVE, naiveTotal).reduce((a, b) => a + b, 0),
  3001,
)

// ── 3. IMPORTED jobs: margins pinned to 0, price must equal cost ───────────
const ZERO = { laborMarginPct: 0, materialMarginPct: 0, consumableMarginPct: 0 }
const frozen = [
  sub({ customCost: 168090 }),
  sub({ laborCost: 4890 }),
]
const frozenCost = Object.values(sumBuckets(frozen)).reduce((a, b) => a + b, 0)
ck('imported job: price === cost, no markup', priceOf(sumBuckets(frozen), ZERO), frozenCost)
ck(
  'imported job: cards sum to the frozen total',
  allocateRounded(
    frozen.map((s) => priceOf(s, ZERO)),
    priceOf(sumBuckets(frozen), ZERO),
  ).reduce((a, b) => a + b, 0),
  Math.round(frozenCost),
)

// ── 4. Allocation edge cases ───────────────────────────────────────────────
ck('empty list', allocateRounded([], 0), [])
ck('single row takes the whole total', allocateRounded([99.6], 100), [100])
ck('already-integer values are untouched', allocateRounded([10, 20, 30], 60), [10, 20, 30])
ck(
  'over-allocation takes dollars back',
  allocateRounded([10.9, 10.9, 10.9], 32).reduce((a, b) => a + b, 0),
  32,
)
ck('a zero-priced sub stays zero', allocateRounded([0, 100.5], 101), [0, 101])

// Stability: same input, same output. A card must not swap a dollar with its
// neighbour just because the page re-rendered.
const a1 = allocateRounded([33.34, 33.33, 33.33], 100)
const a2 = allocateRounded([33.34, 33.33, 33.33], 100)
ck('deterministic', a1, a2)
ck('thirds sum to the whole', a1.reduce((a, b) => a + b, 0), 100)

// The classic: $10,000 across 3 cannot be expressed evenly, but must still sum.
const thirds = allocateRounded([3333.33, 3333.33, 3333.34], 10000)
ck('10,000 / 3 sums exactly', thirds.reduce((a, b) => a + b, 0), 10000)

// Drift detection must actually fire on a real modelling error.
ck('drift spots a total that is not the sum', allocationDrift([100, 100], 250), 50)

console.log(bad ? `\n${bad} FAILING` : '\nall subproject-price cases pass')
process.exit(bad ? 1 : 0)
