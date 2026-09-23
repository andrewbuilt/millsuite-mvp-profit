'use client'

// ============================================================================
// DuplicateProjectModal — the "Copy project" confirm dialog.
// ============================================================================
// One component mounted from BOTH surfaces that offer Duplicate (the kanban
// card menu and the project page header) so the wording of what copies and
// what doesn't can never disagree between them. The name is editable here —
// "{name} · Option 2" is only the default.
//
// The list of what does NOT copy is printed in the dialog on purpose: the
// scariest failure mode of a copy feature is someone assuming the payment
// schedule or portal came along. Say it before the click, not in a doc.
// ============================================================================

import { useState } from 'react'
import { Copy, X } from 'lucide-react'
import {
  duplicateDefaultName,
  duplicateProject,
  duplicateTargetStage,
} from '@/lib/duplicate-project'

const STAGE_WORD: Record<string, string> = {
  new_lead: 'New lead',
  fifty_fifty: '50/50',
  ninety_percent: '90%',
}

export function DuplicateProjectModal({
  project,
  onClose,
  onDone,
}: {
  project: { id: string; name: string; stage: string }
  onClose: () => void
  /** Called with the NEW project's id after a successful copy. */
  onDone: (newProjectId: string) => void
}) {
  const [name, setName] = useState(() => duplicateDefaultName(project.name))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const landing = STAGE_WORD[duplicateTargetStage(project.stage)] ?? '90%'

  async function run() {
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const newId = await duplicateProject(project.id, name)
      onDone(newId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The copy failed.')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5E7EB] rounded-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Copy project
            </div>
            <div className="text-base font-semibold text-[#111] truncate">{project.name}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block mt-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            Name for the copy
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
              if (e.key === 'Escape') onClose()
            }}
            className="w-full mt-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]"
          />
        </label>

        <div className="mt-3 text-[12px] text-[#374151] leading-relaxed">
          Copies the subprojects, estimate lines, descriptions and install setup —
          priced exactly like the original until you change it. Lands in{' '}
          <strong>{landing}</strong>.
        </div>
        <div className="mt-2 text-[11px] text-[#9CA3AF] leading-relaxed">
          Not copied: payments &amp; draws, invoices, sent estimates, approvals, drawings,
          tracked time, tasks, notes, change orders, portal history.
        </div>

        {error && (
          <div className="mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111]"
          >
            Cancel
          </button>
          <button
            onClick={() => void run()}
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            <Copy className="w-3.5 h-3.5" />
            {busy ? 'Copying…' : 'Duplicate'}
          </button>
        </div>
      </div>
    </div>
  )
}
