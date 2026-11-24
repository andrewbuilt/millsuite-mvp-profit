'use client'

// ============================================================================
// ProjectTaskButton — "+ Task" + "Tasks · N" for a project page header.
// ============================================================================
// "+ Task" opens the task modal in create mode, pre-linked to THIS project —
// capture a thought without leaving the job. (It used to be its own little
// popover form; every create is the one modal now — see NewTaskModal.) The
// "Tasks · N" affordance opens the panel pre-filtered to this project.
// ============================================================================

import { useState } from 'react'
import { ListChecks, Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { localISO } from '@/lib/tasks'
import { NewTaskModal } from './TaskRow'
import { useTasksOptional } from './TasksProvider'

export default function ProjectTaskButton({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const ctx = useTasksOptional()
  const [creating, setCreating] = useState(false)

  if (!ctx || !ctx.enabled) return null
  const openCount = ctx.openCountByProject[projectId] || 0

  return (
    <div className="relative inline-flex items-center gap-2">
      {openCount > 0 && (
        <button
          onClick={() => ctx.openPanel({ projectId })}
          title="Open this project's tasks"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#6B7280] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] hover:text-[#111] transition-colors"
        >
          <ListChecks className="w-3.5 h-3.5" />
          Tasks · {openCount}
        </button>
      )}
      <button
        onClick={() => setCreating(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#2563EB] bg-white border border-[#2563EB] rounded-lg hover:bg-[#EFF6FF] transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Task
      </button>

      {creating && (
        <NewTaskModal
          preset={{ needBy: localISO(), projectId }}
          orgId={user?.org_id}
          userId={user?.id ?? null}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  )
}
