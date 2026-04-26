'use client'

// ============================================================================
// NewSubprojectModal — name a subproject, persist, route to its editor.
// ============================================================================
// Triggered from the project detail page's "+ Add subproject" tile.
// Replaces the legacy /projects/[id]/subprojects/new full-page route so the
// operator stays in context; the only state to capture before opening the
// line editor is a name.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props {
  projectId: string
  orgId: string
  /** Used to seed subprojects.defaults.consumablesPct on insert. */
  orgConsumablePct: number | null
  onClose: () => void
}

export default function NewSubprojectModal({
  projectId,
  orgId,
  orgConsumablePct,
  onClose,
}: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function create() {
    if (!name.trim()) {
      setErr('Give this subproject a name.')
      return
    }
    setErr(null)
    setSaving(true)
    const { data: last } = await supabase
      .from('subprojects')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextOrder = last?.sort_order != null ? Number(last.sort_order) + 1 : 0

    const consumablesPct =
      typeof orgConsumablePct === 'number' && orgConsumablePct > 0
        ? orgConsumablePct
        : 10
    const defaults = { consumablesPct, wastePct: 5 }

    const { data, error } = await supabase
      .from('subprojects')
      .insert({
        project_id: projectId,
        org_id: orgId,
        name: name.trim(),
        sort_order: nextOrder,
        consumable_markup_pct: orgConsumablePct ?? null,
        defaults,
      })
      .select('id')
      .single()

    if (error || !data) {
      setErr(error?.message || 'Could not create subproject.')
      setSaving(false)
      return
    }
    router.push(`/projects/${projectId}/subprojects/${data.id}`)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '64px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] bg-white border border-[#E5E7EB] rounded-2xl shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
          <div className="text-[13px] font-semibold text-[#111]">New subproject</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          <p className="text-[12px] text-[#6B7280] mb-4 leading-relaxed">
            Subprojects are the rooms or pieces of the job. Name it and we'll
            drop you into the line editor — the composer handles the rest.
          </p>

          <label className="block">
            <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              Name
            </span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create()
                if (e.key === 'Escape') onClose()
              }}
              placeholder="e.g. Kitchen cabinets · Master vanity · Library built-ins"
              className="mt-1 w-full px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
            />
          </label>

          {err && (
            <div className="mt-3 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#B91C1C]">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-[#F9FAFB] border-t border-[#E5E7EB]">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Continue to editor'}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
