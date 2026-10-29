'use client'

// ============================================================================
// AttentionCard — the ATTENTION RINGS as a list, worst first (2026-10-29).
// ============================================================================
// The same signal the board cards wear (lib/attention), across every stage:
// "Batia · sent 3w ago", "Kinser · +8h over". Capped at 8 rows; each links to
// the project. A row's chip comes from the same function as its card, so the
// two can't disagree.
//
// Sits beside the Watch list rather than replacing it: the Watch list is a
// BUDGET signal (spend vs bid), which no attention clock measures. Over-hours
// production jobs appear here too, as red.
//
// Day-one rule (see the /pm header): nothing needing attention → no card.
// ============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { loadExcludedProjectIds } from '@/lib/practice'
import { loadArchivedProjectIds } from '@/lib/project-archive'
import { loadProjectDeptHours } from '@/lib/project-hours'
import { loadProjectActuals } from '@/lib/actual-hours'
import {
  RING_STYLE,
  ageAttention,
  attentionScore,
  fillAttention,
  type Attention,
} from '@/lib/attention'
import { loadProjectTouches } from '@/lib/attention-data'

const CAP = 8

interface Row {
  id: string
  name: string
  attention: Attention
  phrase: string
  level: 1 | 2 | 3
}

export default function AttentionCard({ orgId }: { orgId: string | undefined }) {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const [projRes, excluded, archived, touches] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, stage, created_at, estimate_sent_at, sold_at')
          .eq('org_id', orgId)
          .in('stage', ['new_lead', 'fifty_fifty', 'ninety_percent', 'sold', 'production']),
        loadExcludedProjectIds(orgId),
        loadArchivedProjectIds(orgId),
        loadProjectTouches(orgId),
      ])
      if (cancelled) return
      const projects = ((projRes.data || []) as {
        id: string
        name: string
        stage: string
        created_at: string | null
        estimate_sent_at: string | null
        sold_at: string | null
      }[]).filter((p) => !excluded.has(p.id) && !archived.has(p.id))

      const now = Date.now()
      const out: Row[] = []
      for (const p of projects) {
        if (p.stage === 'production') continue
        const a = ageAttention({ ...p, lastTouch: touches[p.id]?.touch }, now)
        if (a && a.level > 0) out.push({ id: p.id, name: p.name, attention: a, phrase: a.phrase, level: a.level as 1 | 2 | 3 })
      }
      // Production: the fill ring, listed only when over.
      const prod = projects.filter((p) => p.stage === 'production')
      const fills = await Promise.all(
        prod.map(async (p) => {
          const [h, act] = await Promise.all([loadProjectDeptHours(orgId, p.id), loadProjectActuals(p.id)])
          return { p, a: fillAttention(h.totalHours, act.totalMinutes / 60) }
        }),
      )
      if (cancelled) return
      for (const { p, a } of fills) {
        if (a && a.chip) out.push({ id: p.id, name: p.name, attention: a, phrase: a.chip, level: 3 })
      }
      out.sort((x, y) => attentionScore(y.attention) - attentionScore(x.attention))
      setTotal(out.length)
      setRows(out.slice(0, CAP))
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  if (rows.length === 0) return null

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-[#F3F4F6] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 text-[#B91C1C] flex-shrink-0" />
          <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Needs attention</span>
          <span className="text-xs text-[#D1D5DB]">{total}</span>
        </div>
        <Link href="/projects" className="text-[11px] text-[#2563EB] hover:underline whitespace-nowrap">
          Projects →
        </Link>
      </div>
      {rows.map((r, i) => {
        const s = RING_STYLE[r.level]
        return (
          <Link
            key={r.id}
            href={`/projects/${r.id}`}
            title={r.attention.tooltip}
            className={`flex items-center gap-3 px-4 sm:px-5 py-2.5 hover:bg-[#F9FAFB] transition-colors ${
              i === rows.length - 1 ? '' : 'border-b border-[#F3F4F6]'
            }`}
          >
            {/* The ring, in miniature: same width + colour as the card's. */}
            <span
              className="flex-shrink-0 w-3 h-3 rounded-full"
              style={{ boxShadow: `inset 0 0 0 ${s.width}px ${s.color}` }}
            />
            <span className="text-[13px] text-[#111] font-medium truncate flex-1">{r.name}</span>
            <span
              className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ background: s.chipBg, color: s.chipFg }}
            >
              {r.phrase}
            </span>
          </Link>
        )
      })}
      {total > CAP && (
        <div className="px-4 sm:px-5 py-2 text-[11px] text-[#9CA3AF] border-t border-[#F3F4F6]">+{total - CAP} more</div>
      )}
    </section>
  )
}
