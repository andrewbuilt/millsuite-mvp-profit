'use client'

// ============================================================================
// LeadSourcePill — the lead source, editable, in the project header pill row
// ============================================================================
// The capture spec's second surface: most existing projects predate the
// picker, so the header is where their source gets back-filled by a human
// who remembers. Reads like the client/address pills; click to edit in
// place, saves through lib/lead-sources (zero-row guarded), keeps its own
// state so the giant project page doesn't reload for a tag.
// ============================================================================

import { useState } from 'react'
import LeadSourcePicker from '@/components/sales/LeadSourcePicker'
import { setProjectLeadSource } from '@/lib/lead-sources'

export default function LeadSourcePill({
  projectId,
  orgId,
  initial,
}: {
  projectId: string
  orgId: string
  initial: string | null
}) {
  const [source, setSource] = useState<string | null>(initial)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save(next: string | null) {
    setEditing(false)
    if (next === source) return
    setBusy(true)
    try {
      await setProjectLeadSource(projectId, next)
      setSource(next)
    } catch (e) {
      console.error('LeadSourcePill', e)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <span className="inline-block min-w-[160px]">
        <LeadSourcePicker orgId={orgId} value={source} onChange={(s) => void save(s)} compact />
      </span>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      disabled={busy}
      title="Lead source — click to change"
      className={`px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 ${
        source
          ? 'bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB]'
          : 'border border-dashed border-[#D1D5DB] text-[#9CA3AF] hover:text-[#2563EB] hover:border-[#2563EB]'
      }`}
    >
      {source ? `via ${source}` : '+ source'}
    </button>
  )
}
