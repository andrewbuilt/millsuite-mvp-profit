'use client'

// ============================================================================
// /sales/lost — the lost archive. The board stays clean; nothing is deleted.
// ============================================================================
// Lost cards leave the live kanban after ~30 days (the filter lives in the
// kanban's columns memo) but live here forever, grouped by the month they
// died. Each row carries what the post-mortem needs: value, where the lead
// came from, why it died, and how long it sat in the pipeline. The sales
// report (/reports) computes over the same stamps; this page is the
// row-level truth behind those aggregates.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

interface LostRow {
  id: string
  name: string
  clientName: string | null
  value: number
  leadSource: string | null
  lostReason: string | null
  lostAt: string | null
  createdAt: string | null
}

function money(n: number): string {
  return n > 0 ? `$${Math.round(n).toLocaleString()}` : '—'
}

function monthLabel(ym: string): string {
  if (ym === 'unknown') return 'Date unknown'
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

/** Whole days created → lost. Null when either stamp is missing. */
function daysInPipeline(r: LostRow): number | null {
  if (!r.lostAt || !r.createdAt) return null
  const ms = new Date(r.lostAt).getTime() - new Date(r.createdAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.round(ms / 86400000)
}

export default function LostArchivePage() {
  const { org } = useAuth()
  const [rows, setRows] = useState<LostRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, client_name, bid_total, estimated_price, lead_source, lost_reason, lost_at, created_at')
        .eq('org_id', org.id)
        .eq('stage', 'lost')
        .order('lost_at', { ascending: false, nullsFirst: false })
      if (cancelled) return
      if (error) {
        console.error('lost archive', error)
        setRows([])
      } else {
        setRows(
          ((data || []) as any[]).map((r) => ({
            id: r.id,
            name: r.name || 'Untitled',
            clientName: r.client_name ?? null,
            value: Number(r.bid_total) || Number(r.estimated_price) || 0,
            leadSource: r.lead_source ?? null,
            lostReason: r.lost_reason ?? null,
            lostAt: r.lost_at ?? null,
            createdAt: r.created_at ?? null,
          })),
        )
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  // Grouped by the month it died. Null lost_at (pre-116, unback-fillable)
  // groups under "Date unknown" at the bottom — a real bucket, not a guess.
  const groups = useMemo(() => {
    const m = new Map<string, LostRow[]>()
    for (const r of rows) {
      const key = r.lostAt ? r.lostAt.slice(0, 7) : 'unknown'
      const list = m.get(key)
      if (list) list.push(r)
      else m.set(key, [r])
    }
    return [...m.entries()].sort((a, b) =>
      a[0] === 'unknown' ? 1 : b[0] === 'unknown' ? -1 : b[0].localeCompare(a[0]),
    )
  }, [rows])

  const total = rows.reduce((s, r) => s + r.value, 0)

  return (
    <PlanGate requires="sales">
      <div className="max-w-[900px] mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-1">
          <Link
            href="/sales/kanban"
            className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#111]">Lost projects</h1>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {rows.length} project{rows.length === 1 ? '' : 's'} ·{' '}
              <span className="font-mono tabular-nums">{money(total)}</span> — off the board
              after 30 days, kept here forever.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-[#9CA3AF] py-16 text-center">
            Nothing lost yet. May it stay that way.
          </div>
        ) : (
          groups.map(([month, list]) => (
            <section key={month} className="mt-6">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-2">
                {monthLabel(month)}{' '}
                <span className="text-[#D1D5DB] normal-case tracking-normal">
                  · {list.length} · {money(list.reduce((s, r) => s + r.value, 0))}
                </span>
              </div>
              <div className="bg-white border border-[#E5E7EB] rounded-xl divide-y divide-[#F3F4F6]">
                {list.map((r) => {
                  const days = daysInPipeline(r)
                  return (
                    <Link
                      key={r.id}
                      href={`/projects/${r.id}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-[#F9FAFB] transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13.5px] font-medium text-[#111]">{r.name}</span>
                          {r.clientName && (
                            <span className="text-[11px] text-[#6B7280]">{r.clientName}</span>
                          )}
                          {r.leadSource && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280]">
                              via {r.leadSource}
                            </span>
                          )}
                        </div>
                        {r.lostReason && (
                          <div className="mt-0.5 text-[12px] text-[#6B7280] leading-snug">
                            {r.lostReason}
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[12.5px] font-mono tabular-nums text-[#374151]">
                          {money(r.value)}
                        </div>
                        <div className="text-[10.5px] text-[#9CA3AF] mt-0.5">
                          {days != null ? `${days}d in pipeline` : '—'}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </PlanGate>
  )
}
