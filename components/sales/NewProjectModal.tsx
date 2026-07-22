'use client'

// ============================================================================
// NewProjectModal — create a lead in place (name + client) from the kanban.
// On save: createBlankLeadProject (stage 'new_lead') and hand the row back so
// the caller drops the card into the kanban without navigating away.
// ============================================================================

import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import NewProjectClientPicker from '@/components/sales/NewProjectClientPicker'
import { createBlankLeadProject, type SalesProject } from '@/lib/sales'

export default function NewProjectModal({
  orgId,
  onClose,
  onCreated,
}: {
  orgId: string
  onClose: () => void
  onCreated: (project: SalesProject) => void
}) {
  const [name, setName] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const p = await createBlankLeadProject({
        org_id: orgId,
        name: name.trim(),
        client_id: clientId,
        client_name: clientId ? clientName.trim() || null : null,
      })
      if (!p) throw new Error('Could not create the project.')
      onCreated(p)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center px-4 py-16 overflow-y-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-[460px] bg-white rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
          <div className="text-[16px] font-semibold text-[#111]">New project</div>
          <button onClick={onClose} aria-label="Close" className="text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="mb-3">
            <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              Project name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
              placeholder="Henderson kitchen remodel"
              className="mt-1 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB]"
            />
          </div>
          <div className="mb-1">
            <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              Client (optional)
            </label>
            <NewProjectClientPicker
              orgId={orgId}
              name={clientName}
              clientId={clientId}
              onPick={(c) => {
                if (c) {
                  setClientName(c.name)
                  setClientId(c.id)
                } else {
                  setClientName('')
                  setClientId(null)
                }
              }}
              onSubmitForm={handleCreate}
            />
          </div>

          {error && (
            <div className="mt-3 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#B91C1C]">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[#E5E7EB]">
          <button onClick={onClose} disabled={creating} className="px-3.5 py-2 text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> {creating ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  )
}
