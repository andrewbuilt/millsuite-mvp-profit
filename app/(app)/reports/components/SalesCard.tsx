'use client'

// ============================================================================
// SalesCard — the sales dashboard (lives on /sales; math in lib/sales-report)
// ============================================================================
// Redesigned to Andrew's spec (2026-09-23): the VALUE CHART leads — bid value
// by calendar month, one segment per outcome (won green · lost red · open
// blue), each toggleable, count+value on hover. Segments are outcomes of the
// bids SENT that month, so the stack IS the month's total — honest
// arithmetic, no double counting. Then the month-to-date KPIs and the three
// bid lists (new · lost-with-timeline · open) behind focus chips.
//
// THE HONESTY RULE survives the redesign: the header prints the window the
// numbers are computed from; nothing extrapolates.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { TrendingUp } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import {
  bidOutcome,
  buildSalesReport,
  daysToClose,
  isBid,
  type SalesFactRow,
} from '@/lib/sales-report'

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const moneyK = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'

const COLORS = { won: '#059669', lost: '#DC2626', open: '#3B82F6' } as const
type Segment = keyof typeof COLORS
type ListFocus = 'all' | 'new' | 'lost' | 'open'

export default function SalesCard() {
  const { org } = useAuth()
  const [rows, setRows] = useState<SalesFactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [segments, setSegments] = useState<Record<Segment, boolean>>({
    won: true,
    lost: true,
    open: true,
  })
  const [focus, setFocus] = useState<ListFocus>('all')

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
      if (error) console.error('SalesCard', error)
      else
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
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  const report = useMemo(() => buildSalesReport(rows, new Date()), [rows])

  // ── Month-to-date lists ──
  const nowYm = new Date().toISOString().slice(0, 7)
  const lists = useMemo(() => {
    const bids = rows.filter(isBid)
    return {
      // Sent this month, whatever has become of them since.
      fresh: bids.filter((r) => r.estimateSentAt!.slice(0, 7) === nowYm),
      // Died this month — the timeline is sent → lost.
      lostMtd: bids.filter((r) => bidOutcome(r) === 'lost' && (r.lostAt || '').slice(0, 7) === nowYm),
      // Everything still undecided, any age.
      open: bids.filter((r) => bidOutcome(r) === 'open'),
    }
  }, [rows, nowYm])

  if (loading) return null
  const { kpis, perClient, perSource, seasonalityValue, window: win } = report

  const maxStack = Math.max(
    1,
    ...seasonalityValue.map(
      (s) =>
        (segments.won ? s.wonValue : 0) +
        (segments.lost ? s.lostValue : 0) +
        (segments.open ? s.openValue : 0),
    ),
  )
  const CHART_H = 120

  const showNew = focus === 'all' || focus === 'new'
  const showLost = focus === 'all' || focus === 'lost'
  const showOpen = focus === 'all' || focus === 'open'

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
        {/* ── The value chart, on top ── */}
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <SectionLabel>Bid value by calendar month · all years · by month sent</SectionLabel>
            <div className="flex items-center gap-1.5">
              {(['won', 'lost', 'open'] as Segment[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setSegments((s) => ({ ...s, [k]: !s[k] }))}
                  className={`inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full border transition-colors ${
                    segments[k] ? 'border-transparent text-white' : 'border-[#E5E7EB] text-[#9CA3AF] bg-white'
                  }`}
                  style={segments[k] ? { background: COLORS[k] } : undefined}
                >
                  {k === 'won' ? 'Won' : k === 'lost' ? 'Lost' : 'Open'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-1.5" style={{ height: CHART_H + 18 }}>
            {seasonalityValue.map((s) => {
              // Typed BEFORE the .filter — an annotation doesn't reach
              // through a method call, so the literal widened k to string
              // and Vercel's (stricter) tsc failed the build.
              const all: Array<{ k: Segment; count: number; value: number }> = [
                { k: 'lost', count: s.lostCount, value: s.lostValue },
                { k: 'won', count: s.wonCount, value: s.wonValue },
                { k: 'open', count: s.openCount, value: s.openValue },
              ]
              const segs = all.filter((x) => segments[x.k] && x.value > 0)
              return (
                <div key={s.month} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full">
                  {/* col-reverse: first segment renders at the BOTTOM of the
                      stack (lost, then won, then open on top). */}
                  <div className="w-full flex flex-col-reverse justify-start" style={{ height: CHART_H }}>
                    {segs.map((x) => (
                      <div
                        key={x.k}
                        title={`${MONTHS[s.month - 1]} · ${x.k === 'won' ? 'Won' : x.k === 'lost' ? 'Lost' : 'Open'}: ${x.count} bid${x.count === 1 ? '' : 's'} · ${money(x.value)}`}
                        className="w-full first:rounded-b last:rounded-t"
                        style={{
                          height: `${Math.max(3, (x.value / maxStack) * CHART_H)}px`,
                          background: COLORS[x.k],
                        }}
                      />
                    ))}
                  </div>
                  <div className="text-[8.5px] text-[#9CA3AF]">{MONTHS[s.month - 1][0]}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Month to date ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Bids out this month" value={`${kpis.bidsThisMonth} · ${moneyK(kpis.bidsThisMonthValue)}`} />
          <Kpi label="Win rate" value={kpis.winRatePct != null ? `${kpis.winRatePct}%` : '—'} sub="won ÷ decided bids" />
          <Kpi label="Avg days to close" value={kpis.avgDaysToClose != null ? `${kpis.avgDaysToClose}d` : '—'} sub="sent → sold" />
          <Kpi label="Lost value" value={moneyK(kpis.lostValue)} sub="all recorded losses" />
        </div>

        {/* ── The bid lists, behind focus chips ── */}
        <div>
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            {(
              [
                ['all', 'All'],
                ['new', `New this month · ${lists.fresh.length}`],
                ['lost', `Lost this month · ${lists.lostMtd.length}`],
                ['open', `Open bids · ${lists.open.length}`],
              ] as Array<[ListFocus, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFocus(k)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  focus === k
                    ? 'bg-[#111] text-white border-[#111]'
                    : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {showNew && (
              <BidList
                title="New bids this month"
                empty="No estimates sent yet this month."
                rows={lists.fresh.map((r) => ({
                  id: r.id,
                  name: r.name,
                  client: r.clientName,
                  right: money(r.value),
                  sub: `Sent ${day(r.estimateSentAt)}${bidOutcome(r) === 'won' ? ` · won ${day(r.soldAt)}` : bidOutcome(r) === 'lost' ? ` · lost ${day(r.lostAt)}` : ''}`,
                }))}
              />
            )}
            {showLost && (
              <BidList
                title="Lost this month"
                empty="Nothing lost this month."
                tone="lost"
                rows={lists.lostMtd.map((r) => {
                  const sent = r.estimateSentAt || r.createdAt
                  const days =
                    sent && r.lostAt
                      ? Math.round((new Date(r.lostAt).getTime() - new Date(sent).getTime()) / 86400000)
                      : null
                  return {
                    id: r.id,
                    name: r.name,
                    client: r.clientName,
                    right: money(r.value),
                    sub: `Bid ${day(sent)} → lost ${day(r.lostAt)}${days != null ? ` · ${days}d` : ''}${r.lostReason ? ` — ${r.lostReason}` : ''}`,
                  }
                })}
              />
            )}
            {showOpen && (
              <BidList
                title="Open bids"
                empty="No undecided bids."
                rows={lists.open.map((r) => {
                  const days = r.estimateSentAt
                    ? Math.round((Date.now() - new Date(r.estimateSentAt).getTime()) / 86400000)
                    : null
                  return {
                    id: r.id,
                    name: r.name,
                    client: r.clientName,
                    right: money(r.value),
                    sub: `Sent ${day(r.estimateSentAt)}${days != null ? ` · out ${days}d` : ''}`,
                  }
                })}
              />
            )}
          </div>
        </div>

        {/* ── By client ── */}
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

        {/* ── By lead source ── */}
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
      </div>
    </section>
  )
}

function BidList({
  title,
  rows,
  empty,
  tone,
}: {
  title: string
  rows: Array<{ id: string; name: string; client: string | null; right: string; sub: string }>
  empty: string
  tone?: 'lost'
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-[11.5px] text-[#D1D5DB] italic">{empty}</div>
      ) : (
        <div className="border border-[#F3F4F6] rounded-lg divide-y divide-[#F3F4F6]">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/projects/${r.id}`}
              className="flex items-start gap-3 px-3 py-2 hover:bg-[#F9FAFB] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-[#111]">
                  {r.name}
                  {r.client && <span className="ml-1.5 text-[11px] font-normal text-[#6B7280]">{r.client}</span>}
                </div>
                <div className={`text-[11px] mt-0.5 ${tone === 'lost' ? 'text-[#B91C1C]' : 'text-[#9CA3AF]'}`}>
                  {r.sub}
                </div>
              </div>
              <div className="text-[12px] font-mono tabular-nums text-[#374151] flex-shrink-0">{r.right}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
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
    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
      {children}
    </div>
  )
}
