'use client'

// ============================================================================
// CrewEdits — /time's "Edited by crew" strip (Nov batch 2 #7, migration 127)
// ============================================================================
// Workers fix their own time on /me; every fix lands here flagged until a
// manager acknowledges it. Each row says who, which entry, and WAS → NOW
// (edit_before holds the values before the first unreviewed edit). A crew
// "Remove" shows as 0h and acknowledging it deletes the entry for real.
// Renders nothing when there's nothing to review.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { UserPen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fmtActualHours } from '@/lib/actual-hours'
import { acknowledgeCrewEdit, loadCrewEdits, type TimeEntry } from '@/lib/worker-time'

export default function CrewEdits({
  orgId,
  nameByUserId,
  projectNameById,
  deptNameById,
  onChanged,
  refreshKey,
}: {
  orgId: string
  nameByUserId: (userId: string) => string
  projectNameById: Record<string, string>
  deptNameById: Record<string, string>
  /** After an acknowledge — the page refetches its own entries. */
  onChanged: () => void
  refreshKey?: unknown
}) {
  const [rows, setRows] = useState<TimeEntry[]>([])
  const [subNames, setSubNames] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await loadCrewEdits(orgId)
    setRows(r)
    const subIds = new Set<string>()
    for (const e of r) {
      if (e.subproject_id) subIds.add(e.subproject_id)
      if (e.edit_before?.subproject_id) subIds.add(e.edit_before.subproject_id)
    }
    if (subIds.size) {
      const { data } = await supabase.from('subprojects').select('id, name').in('id', [...subIds])
      setSubNames(Object.fromEntries((data || []).map((s) => [s.id, s.name])))
    }
  }, [orgId])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  if (rows.length === 0) return null

  const where = (projectId: string, subId: string | null) =>
    `${projectNameById[projectId] || 'Job'}${subId ? ` › ${subNames[subId] || 'Subproject'}` : ''}`
  const dept = (id: string | null) => (id ? deptNameById[id] || 'Dept' : 'No dept')

  return (
    <div className="mb-6 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4">
      <div className="flex items-center gap-2 mb-2">
        <UserPen className="w-4 h-4 text-[#B45309]" />
        <h2 className="text-sm font-semibold text-[#92400E]">Edited by crew · {rows.length}</h2>
        <span className="text-[11px] text-[#B45309]">Workers fixed their own time — acknowledge each one.</span>
      </div>
      {err && <div className="mb-2 text-[12px] text-[#B91C1C]">{err}</div>}
      <div className="divide-y divide-[#FDE68A]">
        {rows.map((e) => {
          const b = e.edit_before
          const removed = (e.duration_minutes || 0) === 0
          const changes: string[] = []
          if (removed) changes.push(`removed (was ${fmtActualHours(b?.duration_minutes ?? 0)})`)
          else {
            if (b && b.duration_minutes !== e.duration_minutes)
              changes.push(`${fmtActualHours(b.duration_minutes)} → ${fmtActualHours(e.duration_minutes)}`)
            if (b && (b.project_id !== e.project_id || (b.subproject_id ?? null) !== (e.subproject_id ?? null)))
              changes.push(`${where(b.project_id, b.subproject_id)} → ${where(e.project_id, e.subproject_id)}`)
            if (b && (b.department_id ?? null) !== (e.department_id ?? null))
              changes.push(`${dept(b.department_id)} → ${dept(e.department_id)}`)
            if (changes.length === 0) changes.push('saved with no net change')
          }
          return (
            <div key={e.id} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0 text-[12.5px] text-[#111]">
                <div>
                  <span className="font-semibold">{nameByUserId(e.user_id)}</span>
                  <span className="text-[#6B7280]">
                    {' '}
                    · {e.started_at ? new Date(e.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                    {' '}· {where(e.project_id, e.subproject_id)}
                  </span>
                </div>
                <div className="text-[12px] text-[#92400E]">{changes.join(' · ')}</div>
              </div>
              <button
                disabled={busyId === e.id}
                onClick={async () => {
                  setBusyId(e.id)
                  setErr(null)
                  try {
                    await acknowledgeCrewEdit(e)
                    await reload()
                    onChanged()
                  } catch (x) {
                    setErr(x instanceof Error ? x.message : 'That didn’t save.')
                  } finally {
                    setBusyId(null)
                  }
                }}
                className="flex-shrink-0 px-2.5 py-1 text-[11.5px] font-semibold rounded-lg bg-white border border-[#FCD34D] text-[#92400E] hover:bg-[#FEF3C7] disabled:opacity-50"
              >
                {removed ? 'OK, delete it' : 'Acknowledge'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
