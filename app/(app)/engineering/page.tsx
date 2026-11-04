'use client'

// /engineering — the engineering board (batch-2 item D). The board itself is
// components/engineering/EngBoard; this wires it to Supabase + the time clock.

import { useMemo } from 'react'
import { useAuth } from '@/lib/auth-context'
import PlanGate from '@/components/plan-gate'
import EngBoard, { type BoardApi } from '@/components/engineering/EngBoard'
import { loadEngBoard, assignProject, updateAssignment, unassignProject } from '@/lib/eng-board'
import { clockIn, clockOut, type TimeEntry } from '@/lib/worker-time'

export default function EngineeringPage() {
  const { user, org } = useAuth()
  const orgId = org?.id || null
  const api = useMemo<BoardApi | null>(() => {
    if (!orgId) return null
    return {
      load: (from, end) => loadEngBoard(orgId, from, end),
      assign: (projectId, memberId, priority) => assignProject({ orgId, projectId, memberId, priority }),
      update: (id, patch) => updateAssignment(id, patch),
      unassign: (id) => unassignProject(id),
      startTimer: async (userId, projectId, subprojectId, departmentId) => {
        await clockIn({ orgId, userId, projectId, subprojectId, departmentId })
      },
      stopTimer: (entry) => clockOut(entry as unknown as TimeEntry),
      canTime: !!user,
    }
  }, [orgId, user])

  return (
    <PlanGate requires="schedule">
      {api ? <EngBoard api={api} /> : null}
    </PlanGate>
  )
}
