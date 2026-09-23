'use client'

// ============================================================================
// PreProductionCard — sold jobs that haven't started, on the home page.
// ============================================================================
// Andrew, 2026-09-23, two jobs-to-be-done:
//   1. NEW SALES ARE OBVIOUS — "when new projects sell I want it to be more
//      obvious." Anything sold in the last 7 days sits at the top wearing a
//      loud SOLD THIS WEEK badge, not another gray row.
//   2. WAITING TIME IS VISIBLE — every job sitting in pre-production shows
//      how many WEEKS it has waited (from `sold_at`, migration 094), longest
//      first. A job quietly aging in approvals is exactly what nobody notices
//      until install week.
//
// "In pre-production" = stage === 'sold', by definition — starting production
// flips the stage (lib/project-stage.startProduction is the sole writer), so
// there is no second flag to consult and none is consulted.
//
// The approvals figure is `n of m subs ready`, derived the SAME way the
// pre-production page derives it (subproject_approval_status view →
// ready_for_scheduling, counted over the project's subs) so the card can
// never disagree with the page it links to.
//
// ⚠️ NULL `sold_at` SHOWS "—", NEVER A GUESS. Imported/legacy jobs predate the
// stamp; a fake "0w" would read as freshly sold, which is the opposite of the
// truth. They sort AFTER every real wait (unknown ≠ shortest).
//
// Day-one rule (see the /pm header): a shop with nothing in pre-production
// renders NO card at all — an empty "Pre-production" box on a fresh install
// reads as something being wrong.
// ============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Hammer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { loadPracticeProjectIds } from '@/lib/practice'
import { loadSubprojectStatusMap } from '@/lib/subproject-status'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

interface PreProdRow {
  id: string
  name: string
  value: number
  soldAt: string | null
  /** Whole weeks since sold. Null when sold_at is unknown. */
  weeksWaiting: number | null
  soldThisWeek: boolean
  subsReady: number
  subsTotal: number
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/** "3w" · "<1w" · "—". Whole weeks — this is a queue age, not a stopwatch. */
function weeksLabel(row: PreProdRow): string {
  if (row.weeksWaiting == null) return '—'
  return row.weeksWaiting < 1 ? '<1w' : `${row.weeksWaiting}w`
}

export default function PreProductionCard({ orgId }: { orgId: string | undefined }) {
  const [rows, setRows] = useState<PreProdRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const [{ data: rawProjs, error }, practiceIds] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, bid_total, estimated_price, sold_at')
          .eq('org_id', orgId)
          .eq('stage', 'sold'),
        loadPracticeProjectIds(orgId),
      ])
      // Practice projects are the walkthrough's — a tutorial job wearing a
      // SOLD THIS WEEK badge on the real dashboard is noise dressed as news.
      // Same exclusion ProjectsAtRiskCard makes.
      const projs = ((rawProjs || []) as any[]).filter((p) => !practiceIds.has(p.id))
      if (error || projs.length === 0) {
        if (!cancelled) {
          setRows([])
          setLoading(false)
        }
        return
      }

      const ids = projs.map((p) => p.id)
      const { data: subs } = await supabase
        .from('subprojects')
        .select('id, project_id')
        .in('project_id', ids)
      const subList = (subs || []) as Array<{ id: string; project_id: string }>
      const statusMap = await loadSubprojectStatusMap(subList.map((s) => s.id))

      const now = Date.now()
      const built: PreProdRow[] = (projs as any[]).map((p) => {
        const mine = subList.filter((s) => s.project_id === p.id)
        const ready = mine.filter((s) => statusMap[s.id]?.ready_for_scheduling).length
        const soldMs = p.sold_at ? new Date(p.sold_at).getTime() : NaN
        const hasSold = Number.isFinite(soldMs)
        return {
          id: p.id,
          name: p.name || 'Untitled',
          value: Number(p.bid_total) || Number(p.estimated_price) || 0,
          soldAt: hasSold ? p.sold_at : null,
          weeksWaiting: hasSold ? Math.max(0, Math.floor((now - soldMs) / WEEK_MS)) : null,
          soldThisWeek: hasSold && now - soldMs < WEEK_MS,
          subsReady: ready,
          subsTotal: mine.length,
        }
      })

      // New sales first (newest sale on top), then the queue longest-waiting
      // first, with unknown waits last — an unstamped import isn't "newest".
      built.sort((a, b) => {
        if (a.soldThisWeek !== b.soldThisWeek) return a.soldThisWeek ? -1 : 1
        if (a.soldThisWeek && b.soldThisWeek) {
          return new Date(b.soldAt!).getTime() - new Date(a.soldAt!).getTime()
        }
        if ((a.weeksWaiting == null) !== (b.weeksWaiting == null)) {
          return a.weeksWaiting == null ? 1 : -1
        }
        return (b.weeksWaiting ?? 0) - (a.weeksWaiting ?? 0)
      })

      if (!cancelled) {
        setRows(built)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  // Nothing in pre-production → no card. See the day-one rule in the header.
  if (loading || rows.length === 0) return null

  const total = rows.reduce((s, r) => s + r.value, 0)

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-[#F3F4F6] flex items-center gap-2">
        <Hammer className="w-4 h-4 text-[#7C3AED] flex-shrink-0" />
        <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
          Pre-production
        </span>
        <span className="text-xs text-[#6B7280]">
          {rows.length} job{rows.length === 1 ? '' : 's'} ·{' '}
          <span className="font-mono tabular-nums">{money(total)}</span>
        </span>
      </div>

      <div className="divide-y divide-[#F3F4F6]">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/projects/${r.id}/pre-production`}
            className={`flex items-center gap-3 px-4 sm:px-5 py-2.5 hover:bg-[#F9FAFB] transition-colors ${
              r.soldThisWeek ? 'bg-[#ECFDF5] hover:bg-[#D1FAE5]' : ''
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-medium text-[#111] truncate">{r.name}</span>
                {r.soldThisWeek && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#059669] text-white flex-shrink-0">
                    Sold this week
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[#6B7280] mt-0.5">
                {r.subsTotal === 0
                  ? 'No subprojects yet'
                  : `${r.subsReady} of ${r.subsTotal} sub${r.subsTotal === 1 ? '' : 's'} ready`}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-[12.5px] font-mono tabular-nums text-[#374151]">
                {money(r.value)}
              </div>
              <div
                title={
                  r.soldAt
                    ? `Sold ${new Date(r.soldAt).toLocaleDateString()}`
                    : 'No sold date recorded (imported or legacy)'
                }
                className={`text-[11px] font-mono tabular-nums mt-0.5 ${
                  r.weeksWaiting != null && r.weeksWaiting >= 4
                    ? 'text-[#B45309] font-semibold'
                    : 'text-[#9CA3AF]'
                }`}
              >
                {r.soldThisWeek ? 'new' : weeksLabel(r)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
