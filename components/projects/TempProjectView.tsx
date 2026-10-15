'use client'

// ============================================================================
// TempProjectView — the whole project page for an hours-only TEMP project
// ============================================================================
// October batch item 9 (migration 117). Name, subprojects, estimated vs
// tracked hours per department — nothing else. No money, estimate, payments,
// portal, QuickBooks or approvals, by design (lib/temp-projects).
//
// Numbers come from loadSubClockCards — the same hours-only loader the
// worker clock-in cards use — so this page and a phone can't disagree.
// ============================================================================

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { loadSubClockCards, type SubClockCard } from '@/lib/worker-clockin'
import { LABOR_DEPTS, LABOR_DEPT_LABEL } from '@/lib/rate-book-seed'
import { fmtActualHours } from '@/lib/actual-hours'
import { deleteProject } from '@/lib/sales'
import { useConfirm } from '@/components/confirm-dialog'

export default function TempProjectView({
  orgId,
  projectId,
  name,
}: {
  orgId: string
  projectId: string
  name: string
}) {
  const router = useRouter()
  const { confirm } = useConfirm()
  const [cards, setCards] = useState<SubClockCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void loadSubClockCards(orgId, projectId).then((c) => {
      if (alive) setCards(c)
    })
    return () => {
      alive = false
    }
  }, [orgId, projectId])

  async function remove() {
    const ok = await confirm({
      title: 'Delete temp project?',
      message: 'This deletes the project, its subprojects and ALL time tracked against it.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteProject(projectId)
      router.push('/projects')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the project.')
    }
  }

  const totEst = (cards || []).reduce((s, c) => s + c.totalEstHours, 0)
  const totAct = (cards || []).reduce((s, c) => s + c.totalActualMinutes, 0)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <button
        onClick={() => router.push('/projects')}
        className="inline-flex items-center gap-1 text-[13px] text-[#6B7280] hover:text-[#111] mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Projects
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-semibold text-[#111] [overflow-wrap:anywhere]">{name}</h1>
        <button
          onClick={() => void remove()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:text-[#B91C1C] hover:border-[#FECACA] flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
      </div>
      <p className="text-[12px] text-[#9CA3AF] mb-5">
        Temp project — hours only. Clock in to it from /time or the phone app. Left out of
        sales, payments, reports, capacity and the schedule.
      </p>

      {error && (
        <div className="mb-4 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {cards === null ? (
        <div className="text-sm text-[#9CA3AF]">Loading…</div>
      ) : (
        <>
          <div className="mb-4 text-[13px] text-[#374151]">
            <span className="font-mono">{fmtActualHours(totAct)}</span> tracked of{' '}
            <span className="font-mono">{totEst.toFixed(1)}h</span> estimated
          </div>
          <div className="space-y-3">
            {cards.map((c) => (
              <div key={c.subprojectId} className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div className="font-semibold text-[#111] [overflow-wrap:anywhere]">{c.name}</div>
                  <div className="text-[12px] font-mono text-[#6B7280] flex-shrink-0">
                    {fmtActualHours(c.totalActualMinutes)} / {c.totalEstHours.toFixed(1)}h
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {LABOR_DEPTS.map((d) => {
                    const est = c.estHoursByDept[d]
                    const act = c.actualMinutesByDept[d]
                    if (est <= 0 && act <= 0) return null
                    const over = act / 60 > est
                    const pct = est > 0 ? Math.min(100, (act / 60 / est) * 100) : 100
                    return (
                      <div key={d}>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                          {LABOR_DEPT_LABEL[d]}
                        </div>
                        <div className={`text-[12px] font-mono ${over ? 'text-[#B91C1C]' : 'text-[#374151]'}`}>
                          {fmtActualHours(act)} / {est.toFixed(1)}h
                        </div>
                        <div className="h-1.5 rounded-full bg-[#F3F4F6] mt-1 overflow-hidden">
                          <div
                            className={`h-full ${over ? 'bg-[#DC2626]' : 'bg-[#2563EB]'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
                {c.unmappedActualMinutes > 0 && (
                  <div className="mt-2 text-[11px] text-[#9CA3AF]">
                    + {fmtActualHours(c.unmappedActualMinutes)} in other departments
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
