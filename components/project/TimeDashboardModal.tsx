'use client'

// ============================================================================
// TimeDashboardModal — the P&L panel's Labor row, opened (2026-10-29)
// ============================================================================
// Departments with tracked vs budget hours and a bar each (the dept table that
// left the side panel lives HERE now). Pick a department → its entries: who,
// when, hours, with a link to /time filtered to this project.
//
// Tracked numbers come from the page's PROJECT-level actuals (all time on the
// job, incl. hours clocked with no subproject) so this can't disagree with the
// panel or the stage strip's bar. Time with no department picked gets its own
// row — it belongs to no department, and hiding it would make rows not foot.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fmtActualHours } from '@/lib/actual-hours'

type DeptKey = 'eng' | 'cnc' | 'assembly' | 'finish' | 'install'
const DEPTS: { key: DeptKey; label: string }[] = [
  { key: 'eng', label: 'Engineering' },
  { key: 'cnc', label: 'CNC' },
  { key: 'assembly', label: 'Assembly' },
  { key: 'finish', label: 'Finish' },
  { key: 'install', label: 'Install' },
]
type Selected = DeptKey | 'none'

interface Entry {
  id: string
  user_id: string | null
  department_id: string | null
  started_at: string | null
  duration_minutes: number | null
  notes: string | null
}

export default function TimeDashboardModal({
  projectId,
  budgetHours,
  actualMinutes,
  totalActualMinutes,
  deptKeyById,
  onClose,
}: {
  projectId: string
  budgetHours: Record<DeptKey, number>
  actualMinutes: Record<DeptKey, number>
  totalActualMinutes: number
  deptKeyById: Record<string, DeptKey>
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Selected | null>(null)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})

  const mappedMinutes = DEPTS.reduce((s, d) => s + (actualMinutes[d.key] || 0), 0)
  const noDeptMinutes = Math.max(0, totalActualMinutes - mappedMinutes)
  const totalBudget = DEPTS.reduce((s, d) => s + (budgetHours[d.key] || 0), 0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('time_entries')
        .select('id, user_id, department_id, started_at, duration_minutes, notes')
        .eq('project_id', projectId)
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(2000)
      if (cancelled) return
      const rows = (data || []) as Entry[]
      setEntries(rows)
      const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[]
      if (ids.length) {
        const { data: us } = await supabase.from('users').select('id, name').in('id', ids)
        if (cancelled) return
        setNames(Object.fromEntries(((us || []) as { id: string; name: string | null }[]).map((u) => [u.id, u.name || 'Someone'])))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const shown = useMemo(() => {
    if (!entries || !selected) return []
    return entries.filter((e) => {
      const key = e.department_id ? deptKeyById[e.department_id] : undefined
      return selected === 'none' ? !key : key === selected
    })
  }, [entries, selected, deptKeyById])

  const rowCls = (on: boolean) =>
    `w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
      on ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-transparent hover:bg-[#F9FAFB]'
    }`

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white border border-[#E5E7EB] rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#F3F4F6]">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Time</div>
            <div className="text-base font-semibold text-[#111]">
              {fmtActualHours(totalActualMinutes)} tracked of {Math.round(totalBudget * 10) / 10}h budgeted
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/time?project=${projectId}`} className="text-[12px] text-[#2563EB] hover:underline">
              Open in Time →
            </Link>
            <button onClick={onClose} aria-label="Close" className="p-1 text-[#9CA3AF] hover:text-[#111]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] min-h-0 flex-1">
          <div className="p-3 border-b md:border-b-0 md:border-r border-[#F3F4F6] overflow-y-auto">
            {DEPTS.map((d) => {
              const budget = budgetHours[d.key] || 0
              const actualH = (actualMinutes[d.key] || 0) / 60
              const over = budget > 0 && actualH > budget
              const pct = budget > 0 ? Math.min(100, (actualH / budget) * 100) : 0
              return (
                <button key={d.key} onClick={() => setSelected(d.key)} className={rowCls(selected === d.key)}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#111]">{d.label}</span>
                    <span className={`font-mono tabular-nums text-[12px] ${over ? 'text-[#B91C1C]' : 'text-[#374151]'}`}>
                      {fmtActualHours(actualMinutes[d.key] || 0)} / {Math.round(budget * 10) / 10}h
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#F3F4F6] overflow-hidden mt-1.5">
                    <div
                      className={`h-full rounded-full ${over ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`}
                      style={{ width: `${budget > 0 ? pct : actualH > 0 ? 100 : 0}%` }}
                    />
                  </div>
                </button>
              )
            })}
            {noDeptMinutes > 0 && (
              <button onClick={() => setSelected('none')} className={rowCls(selected === 'none')}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#6B7280]">No department</span>
                  <span className="font-mono tabular-nums text-[12px] text-[#374151]">{fmtActualHours(noDeptMinutes)}</span>
                </div>
              </button>
            )}
          </div>

          <div className="p-3 overflow-y-auto">
            {!selected ? (
              <div className="text-[12.5px] text-[#9CA3AF] italic p-3">Pick a department to see its entries.</div>
            ) : entries === null ? (
              <div className="text-[12.5px] text-[#9CA3AF] p-3">Loading entries…</div>
            ) : shown.length === 0 ? (
              <div className="text-[12.5px] text-[#9CA3AF] italic p-3">No time tracked here yet.</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                    <th className="text-left font-semibold pb-1.5">Who</th>
                    <th className="text-left font-semibold pb-1.5">When</th>
                    <th className="text-right font-semibold pb-1.5">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {shown.map((e) => (
                    <tr key={e.id} title={e.notes || undefined}>
                      <td className="py-1.5 text-[#111]">
                        {e.user_id ? (
                          <Link href={`/time?member=${e.user_id}`} className="hover:underline">
                            {names[e.user_id] || '…'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-1.5 text-[#6B7280]">
                        {e.started_at
                          ? new Date(e.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-[#111]">
                        {fmtActualHours(Number(e.duration_minutes) || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
