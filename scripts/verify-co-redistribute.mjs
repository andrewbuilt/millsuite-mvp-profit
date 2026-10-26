// ============================================================================
// verify-co-redistribute.mjs — a change order spreads over the UNPAID draws
// ============================================================================
// Run: npx tsx scripts/verify-co-redistribute.mjs     (pure — no database)
//
// Pins lib/payment-ledger.redistributeDelta (2026-10-26): an accepted CO
// changes the total owed and spreads PROPORTIONALLY over each draw's unpaid
// remainder — paid draws never move, a partial draw moves only its unpaid
// part and never below what it's received, frozen (invoiced) draws never move,
// whole-dollar rounding lands the stored sum on EXACTLY round(delta), and a
// credit that exceeds the unpaid money is returned, never forced negative.
// The headline case is Oliveira (prod, 2026-10-26).
// ============================================================================

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub-key-for-verify-script'

const { redistributeDelta } = await import('../lib/payment-ledger.ts')

let bad = 0
const ck = (label, actual, expected) => {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) < 0.005 : actual === expected
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`)
}
const to = (plan, id, fallback) => plan.amounts.find((a) => a.id === id)?.to ?? fallback
const sumMoved = (plan) => plan.amounts.reduce((s, a) => s + (a.to - a.from), 0)

console.log('— Oliveira: Deposit paid · kickoff partial · the $12,123 row open; CO-01 +$8,638')
const oli = [
  { id: 'dep', stored: 15529, covered: 15529 },
  { id: 'kick', stored: 7765, covered: 1471 },
  { id: 'rest', stored: 12123, covered: 0 },
]
const p1 = redistributeDelta(oli, 8638)
ck('paid Deposit never moves', to(p1, 'dep', 15529), 15529)
ck('stored sum moves by exactly +8,638', sumMoved(p1), 8638)
ck('nothing unabsorbed', p1.unabsorbed, 0)
// unpaid: kick 6294, rest 12123 → share 8638 × 6294/18417 ≈ 2952.04 · × 12123/18417 ≈ 5685.96
ck('kickoff grows by its unpaid share (≈2,952)', to(p1, 'kick', 7765) - 7765, 2952)
ck('the open draw grows by its share (≈5,686)', to(p1, 'rest', 12123) - 12123, 5686)
ck('kickoff still has its $1,471 credited (never below covered)', to(p1, 'kick', 7765) >= 1471, true)

console.log('— a credit shrinks the unpaid money the same way')
const p2 = redistributeDelta(oli, -9694)
ck('stored sum moves by exactly −9,694', sumMoved(p2), -9694)
ck('Deposit still untouched', to(p2, 'dep', 15529), 15529)
ck('kickoff never below its $1,471', to(p2, 'kick', 7765) >= 1471, true)

console.log('— a credit bigger than everything unpaid')
const p3 = redistributeDelta(oli, -30000)
ck('moves at most the unpaid $18,417', sumMoved(p3), -18417)
ck('returns the rest as unabsorbed', p3.unabsorbed, -11583)
ck('kickoff lands exactly on what it received', to(p3, 'kick', 7765), 1471)
ck('open draw lands on 0', to(p3, 'rest', 12123), 0)

console.log('— frozen + fully-paid schedules')
const p4 = redistributeDelta([{ id: 'a', stored: 1000, covered: 0, frozen: true }, { id: 'b', stored: 3000, covered: 0 }], 400)
ck('an invoiced draw never moves', to(p4, 'a', 1000), 1000)
ck('the only movable draw takes all of it', to(p4, 'b', 3000), 3400)
const p5 = redistributeDelta([{ id: 'a', stored: 1000, covered: 1000 }], 500)
ck('everything paid → no write', p5.amounts.length, 0)
ck('…and the whole delta comes back for final-draw balancing', p5.unabsorbed, 500)

console.log('— rounding')
const p6 = redistributeDelta(
  [{ id: 'a', stored: 100, covered: 0 }, { id: 'b', stored: 100, covered: 0 }, { id: 'c', stored: 100, covered: 0 }],
  100,
)
ck('three equal draws + $100 → sum moves by exactly 100', sumMoved(p6), 100)
ck('whole dollars only', p6.amounts.every((a) => Number.isInteger(a.to)), true)
ck('zero delta → nothing', redistributeDelta(oli, 0).amounts.length, 0)

console.log(bad === 0 ? '\nPASS' : `\nFAIL — ${bad}`)
process.exit(bad === 0 ? 0 : 1)
