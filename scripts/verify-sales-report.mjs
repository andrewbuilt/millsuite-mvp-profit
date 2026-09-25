// ============================================================================
// scripts/verify-sales-report.mjs — the sales report's definitions are code
// ============================================================================
//   npx tsx scripts/verify-sales-report.mjs
//
// Win rate, "bid", and time-to-close are DEFINITIONS Andrew signed off on
// (2026-09-23), and each has a wrong-but-plausible neighbour: counting open
// bids as losses, counting unsent leads as bids, flagging a client whose
// bids simply haven't decided. These checks pin the chosen meaning.
// ============================================================================

import { buildSalesReport, bidOutcome, daysToClose, isBid } from '../lib/sales-report.ts'

let bad = 0
const ck = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) bad++
  console.log(
    `${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`,
  )
}

const row = (o) => ({
  id: o.id ?? 'x',
  name: o.name ?? 'Job',
  clientName: o.clientName ?? null,
  value: o.value ?? 0,
  createdAt: o.createdAt ?? '2026-08-01T00:00:00Z',
  estimateSentAt: o.estimateSentAt ?? null,
  soldAt: o.soldAt ?? null,
  lostAt: o.lostAt ?? null,
  stage: o.stage ?? 'new_lead',
  leadSource: o.leadSource ?? null,
  lostReason: o.lostReason ?? null,
})

const NOW = new Date('2026-09-23T12:00:00Z')

// ── Definitions ─────────────────────────────────────────────────────────────
ck('a card without a sent estimate is a LEAD, not a bid', isBid(row({})), false)
ck('sent estimate = bid', isBid(row({ estimateSentAt: '2026-09-01T00:00:00Z' })), true)
ck('stage production counts as won', bidOutcome(row({ stage: 'production' })), 'won')
ck('days to close prefers sent → sold',
  daysToClose(row({ estimateSentAt: '2026-09-01T00:00:00Z', soldAt: '2026-09-11T00:00:00Z', stage: 'sold' })), 10)
ck('days to close falls back to created when never sent',
  daysToClose(row({ createdAt: '2026-09-01T00:00:00Z', soldAt: '2026-09-06T00:00:00Z', stage: 'sold' })), 5)

// ── The report over a small shop ────────────────────────────────────────────
const rows = [
  // Won bid, sent this month, Facebook, client A — 10 days to close.
  row({ id: 'a', clientName: 'A', value: 100, leadSource: 'Facebook',
    estimateSentAt: '2026-09-01T00:00:00Z', soldAt: '2026-09-11T00:00:00Z', stage: 'sold' }),
  // Lost bid, referral, client B.
  row({ id: 'b', clientName: 'B', value: 50, leadSource: 'Referral',
    estimateSentAt: '2026-08-15T00:00:00Z', lostAt: '2026-09-05T00:00:00Z', stage: 'lost' }),
  // OPEN bid, client B — must not count as a loss anywhere.
  row({ id: 'c', clientName: 'B', value: 70, estimateSentAt: '2026-09-20T00:00:00Z', stage: 'ninety_percent' }),
  // Unsent lead — appears in NO rate.
  row({ id: 'd', clientName: 'C', value: 999, stage: 'fifty_fifty' }),
  // Client D: three DECIDED bids, zero wins → flagged.
  row({ id: 'e1', clientName: 'D', value: 10, estimateSentAt: '2026-07-01T00:00:00Z', lostAt: '2026-07-10T00:00:00Z', stage: 'lost' }),
  row({ id: 'e2', clientName: 'D', value: 10, estimateSentAt: '2026-07-02T00:00:00Z', lostAt: '2026-07-11T00:00:00Z', stage: 'lost' }),
  row({ id: 'e3', clientName: 'D', value: 10, estimateSentAt: '2026-07-03T00:00:00Z', lostAt: '2026-07-12T00:00:00Z', stage: 'lost' }),
]
const rep = buildSalesReport(rows, NOW)

ck('bids this month = sent in Sep (won a + open c)', rep.kpis.bidsThisMonth, 2)
ck('bids this month value', rep.kpis.bidsThisMonthValue, 170)
ck('win rate = 1 won ÷ 5 decided (open + leads excluded)', rep.kpis.winRatePct, 20)
ck('avg days to close', rep.kpis.avgDaysToClose, 10)
ck('lost value = all lost bids', rep.kpis.lostValue, 80)
ck('monthly Sep: 1 won $100, 1 lost $50, 50% win',
  rep.monthly.find((m) => m.month === '2026-09'),
  { month: '2026-09', wonCount: 1, wonValue: 100, lostCount: 1, lostValue: 50, winPct: 50 })
ck('client B not flagged — one decided, one open',
  rep.perClient.find((c) => c.client === 'B')?.neverCloses, false)
ck('client D flagged — 3 decided, 0 wins',
  rep.perClient.find((c) => c.client === 'D')?.neverCloses, true)
ck('unsent lead absent from per-client bids',
  rep.perClient.find((c) => c.client === 'C'), undefined)
ck('per-source: Facebook 1/1 won at 10d',
  rep.perSource.find((s) => s.source === 'Facebook'),
  { source: 'Facebook', bids: 1, wins: 1, winPct: 100, avgDaysToClose: 10, totalValue: 100 })
ck('no-source bucket collects every untagged bid (open c + D’s three)',
  rep.perSource.find((s) => s.source === '(no source)')?.bids, 4)
ck('seasonality July: 3 bids sent, 0 wins',
  rep.seasonality[6], { month: 7, bids: 3, wins: 0 })
ck('value seasonality Sep: won a ($100) + open c ($70), segments stack to total',
  rep.seasonalityValue[8],
  { month: 9, wonCount: 1, wonValue: 100, lostCount: 0, lostValue: 0, openCount: 1, openValue: 70 })
ck('value seasonality: a lost bid lands in the month it was SENT (Aug), not lost (Sep)',
  rep.seasonalityValue[7].lostValue, 50)
ck('honesty window starts at the earliest stamp used', rep.window.from, '2026-07-01T00:00:00Z')
ck('empty shop → null rates, no fake zeroes',
  (() => { const r = buildSalesReport([], NOW); return [r.kpis.winRatePct, r.kpis.avgDaysToClose, r.window.from] })(),
  [null, null, null])

console.log(bad === 0 ? '\nAll checks passed.' : `\n${bad} CHECK(S) FAILED.`)
process.exit(bad === 0 ? 0 : 1)
