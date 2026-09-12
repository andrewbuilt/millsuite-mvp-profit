'use client'

// ============================================================================
// ProjectsAtRiskCard — jobs burning through their bid, and the subs doing it.
// ============================================================================
// Moved off /dashboard 2026-09-12 (home consolidation, Andrew's pick). Nothing
// else in the app surfaces this, so it would have died with the page.
//
// The rule is unchanged from the dashboard: a job is "at risk" when it has
// spent more than half its bid, OR any subproject has passed its estimated
// hours. Both matter — a job at 60% spend with hours to spare is fine, and a
// job at 20% spend whose install sub is already over is not.
//
// ⚠️ ACTUAL COST HERE IS LABOUR (hours × shop rate) + VENDOR INVOICES. It is
// not the project P&L; it's the burn signal the old dashboard showed. Don't
// "improve" it into a margin figure without checking it against an imported
// job — see the handoff re-pricing bug in STATE, which is what happens when a
// surface invents its own costing.
// ============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { loadPracticeProjectIds } from '@/lib/practice'

interface Risk {
  id: string
  name: string
  bidTotal: number
  actualTotal: number
  spentPct: number
  overHoursSubs: { name: string; estimated: number; actual: number }[]
}

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

/** How many risky jobs to show before deferring to /projects. */
const PREVIEW = 4

export default function ProjectsAtRiskCard({
  orgId,
  shopRate,
}: {
  orgId: string | undefined
  shopRate: number
}) {
  const [risks, setRisks] = useState<Risk[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [projRes, subRes, entryRes, invRes] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, stage, bid_total')
          .eq('org_id', orgId)
          .in('stage', ['sold', 'production', 'installed']),
        supabase.from('subprojects').select('id, project_id, name, labor_hours').eq('org_id', orgId),
        supabase
          .from('time_entries')
          .select('project_id, subproject_id, duration_minutes')
          .eq('org_id', orgId),
        supabase.from('invoices').select('project_id, total_amount').eq('org_id', orgId),
      ])
      if (cancelled) return

      // Practice projects are walkthrough scratch work priced off the real
      // rate book, so they'd show up here as real overruns. Loaded separately
      // so a pre-088 database degrades to "no practice projects" instead of
      // failing the card.
      const practice = await loadPracticeProjectIds(orgId)
      if (cancelled) return

      const projects = (projRes.data || []).filter((p) => !practice.has(p.id))
      const subs = subRes.data || []
      const entries = entryRes.data || []
      const vendorInvoices = invRes.data || []

      const out: Risk[] = projects
        .map((p) => {
          const laborMinutes = entries
            .filter((e) => e.project_id === p.id)
            .reduce((s, e) => s + (e.duration_minutes || 0), 0)
          const laborCost = (laborMinutes / 60) * shopRate
          const materialCost = vendorInvoices
            .filter((i) => i.project_id === p.id)
            .reduce((s, i) => s + (i.total_amount || 0), 0)
          const actualTotal = laborCost + materialCost
          const bid = p.bid_total || 0
          const spentPct = bid > 0 ? (actualTotal / bid) * 100 : 0

          const overHoursSubs = subs
            .filter((s) => s.project_id === p.id)
            .map((sub) => {
              const mins = entries
                .filter((t) => t.subproject_id === sub.id)
                .reduce((s, t) => s + (t.duration_minutes || 0), 0)
              return {
                name: sub.name,
                estimated: sub.labor_hours,
                actual: Math.round((mins / 60) * 10) / 10,
              }
            })
            .filter((s) => s.estimated > 0 && s.actual > s.estimated)

          return {
            id: p.id,
            name: p.name,
            bidTotal: bid,
            actualTotal,
            spentPct,
            overHoursSubs,
          }
        })
        .filter((p) => p.spentPct > 50 || p.overHoursSubs.length > 0)
        .sort((a, b) => b.spentPct - a.spentPct)

      setRisks(out)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, shopRate])

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-[#F3F4F6] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 text-[#D97706] flex-shrink-0" />
          <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
            Watch list
          </span>
          {!loading && risks.length > 0 && (
            <span className="text-xs text-[#D1D5DB]">{risks.length}</span>
          )}
        </div>
        <Link href="/projects" className="text-[11px] text-[#2563EB] hover:underline whitespace-nowrap">
          All projects →
        </Link>
      </div>

      {loading ? (
        <div className="px-4 sm:px-5 py-4 text-[12.5px] text-[#9CA3AF] italic">
          Checking jobs…
        </div>
      ) : risks.length === 0 ? (
        <div className="px-4 sm:px-5 py-4 text-[12.5px] text-[#9CA3AF] italic">
          Nothing over budget or over hours.
          {/* ⛔ WITH NO SHOP RATE, LABOUR COSTS ZERO and this card is half
              blind — it can still catch over-hours subs, but never a job
              burning its budget. The old dashboard printed the rate in a
              metrics strip beside it, so a $0 was at least visible; that
              strip is gone, so the card has to say it itself. */}
          {shopRate <= 0 && (
            <span className="block mt-1 not-italic text-[11px] text-[#92400E]">
              No shop rate set, so labour counts as $0 here —{' '}
              <Link href="/settings" className="underline">
                set it in Settings
              </Link>{' '}
              for this to mean anything.
            </span>
          )}
        </div>
      ) : (
        <>
          {risks.slice(0, PREVIEW).map((r, i) => (
            <Link
              key={r.id}
              href={`/projects/${r.id}`}
              className={`block px-4 sm:px-5 py-3 hover:bg-[#F9FAFB] transition-colors ${
                i === Math.min(risks.length, PREVIEW) - 1 ? '' : 'border-b border-[#F3F4F6]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-[#111] font-medium truncate">{r.name}</span>
                <span
                  className={`text-[12px] font-mono tabular-nums flex-shrink-0 ${
                    r.spentPct > 90 ? 'text-[#991B1B]' : 'text-[#92400E]'
                  }`}
                >
                  {Math.round(r.spentPct)}% spent
                </span>
              </div>
              <div className="text-[11px] text-[#9CA3AF] font-mono tabular-nums mt-0.5">
                {money(r.actualTotal)} of {money(r.bidTotal)}
              </div>
              {r.overHoursSubs.length > 0 && (
                <div className="text-[11px] text-[#92400E] mt-1 leading-snug">
                  Over hours:{' '}
                  {r.overHoursSubs
                    .slice(0, 2)
                    .map((s) => `${s.name} (${s.actual} vs ${s.estimated}h)`)
                    .join(' · ')}
                  {r.overHoursSubs.length > 2 ? ` +${r.overHoursSubs.length - 2} more` : ''}
                </div>
              )}
            </Link>
          ))}
          {risks.length > PREVIEW && (
            <div className="px-4 sm:px-5 py-2 text-[11px] text-[#9CA3AF] border-t border-[#F3F4F6]">
              +{risks.length - PREVIEW} more
            </div>
          )}
        </>
      )}
    </section>
  )
}
