'use client'

// ============================================================================
// LeadSourcePicker — one select over the org's lead-source registry (116)
// ============================================================================
// Shared by NewProjectModal and the project header pill so the two can't
// offer different lists. "New source…" creates inline (the spec's call —
// capture at the moment of entry beats a settings round-trip); the registry
// dedupes case-insensitively in lib/lead-sources.
// ============================================================================

import { useEffect, useState } from 'react'
import { addLeadSource, loadLeadSources } from '@/lib/lead-sources'

const NEW_SENTINEL = '__new__'

export default function LeadSourcePicker({
  orgId,
  value,
  onChange,
  compact = false,
}: {
  orgId: string
  value: string | null
  onChange: (source: string | null) => void
  /** Smaller text for the header-pill context. */
  compact?: boolean
}) {
  const [sources, setSources] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadLeadSources(orgId).then((s) => {
      if (!cancelled) setSources(s)
    })
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function commitNew() {
    const name = draft.trim()
    setAdding(false)
    setDraft('')
    if (!name) return
    const next = await addLeadSource(orgId, name)
    setSources(next)
    // The canonical spelling — the registry may have matched an existing
    // entry case-insensitively.
    const canonical = next.find((s) => s.toLowerCase() === name.toLowerCase()) ?? name
    onChange(canonical)
  }

  if (adding) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commitNew()
          if (e.key === 'Escape') {
            setAdding(false)
            setDraft('')
          }
        }}
        onBlur={() => void commitNew()}
        placeholder="Facebook, referral, showroom…"
        className={`w-full bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] ${
          compact ? 'text-xs px-2 py-1' : 'text-sm px-3 py-2'
        }`}
      />
    )
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === NEW_SENTINEL) {
          setAdding(true)
          return
        }
        onChange(e.target.value || null)
      }}
      className={`w-full bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] ${
        compact ? 'text-xs px-2 py-1' : 'text-sm px-3 py-2'
      }`}
    >
      <option value="">No source</option>
      {/* A stored value missing from the registry (renamed there) still
          renders and stays selectable. */}
      {value && !sources.includes(value) && <option value={value}>{value}</option>}
      {sources.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
      <option value={NEW_SENTINEL}>+ New source…</option>
    </select>
  )
}
