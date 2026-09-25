'use client'

// ============================================================================
// SalesCard — the sales report, on /reports. Derived, no new tables.
// ============================================================================
// All math lives in lib/sales-report (pure, verify-pinned); this component
// loads the project rows and renders. THE HONESTY RULE is a UI obligation:
// the header prints the window the numbers are computed from, and the
// seasonality strip greys any month with fewer than 3 observations — the
// stamps mostly began Sep 2026, and a "season" inferred from one data point
// is a lie with an axis. It gets smarter every month it runs.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { buildSalesReport, type SalesFactRow } from '@/lib/sales-report'

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const moneyK = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function SalesCard() {
  const { org } = useAuth()
  const [rows, setRows] = useState<SalesFactRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(
          'id, name, client_name, bid_total, estimated_price, created_at, estimate_sent_at, sold_at, lost_at, stage, lead_source, lost_reason',
        )
        .eq('org_id', org.id)
        .is('practice_at', null)
      if (cancelled) return
      if (error) {
        console.error('SalesCard', error)
      } else {
        setRows(
          ((data || []) as any[]).map((r) => ({
            id: r.id,
            name: r.name || '',
            clientName: r.client_name ?? null,
            value: Number(r.bid_total) || Number(r.estimated_price) || 0,
            createdAt: r.created_at ?? null,
            estimateSentAt: r.estimate_sent_at ?? null,
            soldAt: r.sold_at ?? null,
            lostAt: r.lost_at ?? null,
            stage: r.stage || 'new_lead',
            leadSource: r.lead_source ?? null,
            lostReason: r.lost_reason ?? null,
          })),
        )
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  const report = useMemo(() => buildSalesReport(rows, new Date()), [rows])

  if (loading) return null
  const { kpis, monthly, perClient, seasonality, perSource, window: win } = report
  const nothingDecided = kpis.winRatePct === null && monthly.length === 0

  const maxSeason = Math.max(1, ...seasonality.map((s) => s.bids))

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#F3F4F6] flex items-center gap-2 flex-wrap">
        <TrendingUp className="w-4 h-4 text-[#2563EB]" />
        <h2 className="text-base font-semibold text-[#111]">Sales</h2>
        <span className="text-[11px] text-[#9CA3AF] ml-auto">
          {win.from
            ? `Computed from ${new Date(win.from).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} — gets smarter every month`
            : 'No decided bids yet — this fills in as estimates go out and land'}
        </span>
      </div>

      <div className="p-5 space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Bids out this month" value={`${kpis.bidsThisMonth} · ${moneyK(kpis.bidsThisMonthValue)}`} />
          <Kpi label="Win rate" value={kpis.winRatePct != null ? `${kpis.winRatePct}%` : '—'} sub="won ÷ decided bids" />
          <Kpi label="Avg days to close" value={kpis.avgDaysToClose != null ? `${kpis.avgDaysToClose}d` : '—'} sub="sent → sold" />
          <Kpi label="Lost value" value={moneyK(kpis.lostValue)} sub="all recorded losses" />
        </div>

        {nothingDecided ? null : (
          <>
            {/* Monthly won vs lost */}
            <div>
              <SectionLabel>Won vs lost, by month decided</SectionLabel>
              <table className="w-full text-[12px]">
                <tbody>
                  {monthly.slice(-12).map((m) => (
                    <tr key={m.month} className="border-t border-[#F3F4F6]">
                      <td className="py-1.5 text-[#6B7280] w-20">
                        {MONTHS[Number(m.month.slice(5)) - 1]} {m.month.slice(2, 4)}
                      </td>
                      <td className="py-1.5 text-[#047857] font-mono tabular-nums">
                        {m.wonCount > 0 ? `${m.wonCount} won · ${moneyK(m.wonValue)}` : '—'}
                      </td>
                      <td className="py-1.5 text-[#B91C1C] font-mono tabular-nums">
                        {m.lostCount > 0 ? `${m.lostCount} lost · ${moneyK(m.lostValue)}` : '—'}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#374151] w-14">
                        {m.winPct != null ? `${m.winPct}%` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Per client */}
            <div>
              <SectionLabel>By client</SectionLabel>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                    <th className="text-left font-semibold py-1">Client</th>
                    <th className="text-right font-semibold py-1">Bids</th>
                    <th className="text-right font-semibold py-1">Wins</th>
                    <th className="text-right font-semibold py-1">Win %</th>
                    <th className="text-right font-semibold py-1">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {perClient.slice(0, 12).map((c) => (
                    <tr key={c.client} className="border-t border-[#F3F4F6]">
                      <td className="py-1.5 text-[#111]">
                        {c.client}
                        {c.neverCloses && (
                          <span
                            title="3+ decided bids, zero wins — is quoting them worth it?"
                            className="ml-1.5 text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C]"
                          >
                            Never closes
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#374151]">{c.bids}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#374151]">{c.wins}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#374151]">
                        {c.winPct != null ? `${c.winPct}%` : '—'}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#374151]">{money(c.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Seasonality */}
            <div>
              <SectionLabel>Bids by calendar month, all years</SectionLabel>
              <div className="flex items-end gap-1.5 h-16">
                {seasonality.map((s) => {
                  // ⚠️ THIN DATA GREYS OUT — one July doesn't make a season.
                  const thin = s.bids < 3
                  return (
                    <div key={s.month} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        title={`${MONTHS[s.month - 1]}: ${s.bids} bid${s.bids === 1 ? '' : 's'}, ${s.wins} won${thin ? ' — too little data to trust yet' : ''}`}
                        className="w-full rounded-t"
                        style={{
                          height: `${Math.max(2, (s.bids / maxSeason) * 48)}px`,
                          background: thin ? '#E5E7EB' : '#93C5FD',
                        }}
                      />
                      <div className="text-[8.5px] text-[#9CA3AF]">{MONTHS[s.month - 1][0]}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Per lead source — the advertising scoreboard */}
            <div>
              <SectionLabel>By lead source</SectionLabel>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                    <th className="text-left font-semibold py-1">Source</th>
                    <th className="text-right font-semibold py-1">Bids</th>
                    <th className="text-right font-semibold py-1">Win %</th>
                    <th className="text-right font-semibold py-1">Avg close</th>
                    <th className="text-right font-semibold py-1">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {perSource.map((s) => (
                    <tr key={s.source} className="border-t border-[#F3F4F6]">
                      <td className="py-1.5 text-[#111]">{s.source}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#374151]">{s.bids}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#374151]">
                        {s.winPct != null ? `${s.winPct}%` : '—'}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#374151]">
                        {s.avgDaysToClose != null ? `${s.avgDaysToClose}d` : '—'}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#374151]">{money(s.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[#F3F4F6] bg-[#FAFBFC] px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">{label}</div>
      <div className="mt-1 text-[16px] font-semibold font-mono tabular-nums text-[#111]">{value}</div>
      {sub && <div className="text-[10px] text-[#9CA3AF] mt-0.5">{sub}</div>}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5">
      {children}
    </div>
  )
}
