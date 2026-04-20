'use client'

// ============================================================================
// /projects/[id]/subprojects/new — create a subproject, then jump to the editor
// ============================================================================
// Lightweight scaffold: pick a name (and optional activity type), persist,
// then router.replace to /projects/[id]/subprojects/[subId] where the real
// work happens. Replaces the inline "Add Subproject" form from Phase 0.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, ArrowRight } from 'lucide-react'

const ACTIVITY_TYPES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'cabinets', label: 'Cabinets', hint: 'uppers, lowers, pantries' },
  { key: 'millwork', label: 'Millwork', hint: 'built-ins, panels, trim' },
  { key: 'island', label: 'Island', hint: 'single-piece run' },
  { key: 'vanity', label: 'Vanity', hint: 'bathroom vanity set' },
  { key: 'install', label: 'Install', hint: 'time + materials install line' },
  { key: 'custom', label: 'Custom', hint: 'anything else' },
]

export default function NewSubprojectPage() {
  const { id: projectId } = useParams() as { id: string }
  const router = useRouter()
  const { org } = useAuth()

  const [name, setName] = useState('')
  const [activity, setActivity] = useState<string>('cabinets')
  const [projectName, setProjectName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!projectId) return
    ;(async () => {
      const { data } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single()
      if (data) setProjectName(data.name)
    })()
  }, [projectId])

  async function create() {
    if (!name.trim()) {
      setErr('Give this subproject a name.')
      return
    }
    setErr(null)
    setSaving(true)
    // sort_order = current max + 1.
    const { data: last } = await supabase
      .from('subprojects')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextOrder = last?.sort_order != null ? Number(last.sort_order) + 1 : 0

    const { data, error } = await supabase
      .from('subprojects')
      .insert({
        project_id: projectId,
        org_id: org?.id,
        name: name.trim(),
        sort_order: nextOrder,
        activity_type: activity,
        consumable_markup_pct: org?.consumable_markup_pct ?? null,
        profit_margin_pct: org?.profit_margin_pct ?? null,
      })
      .select('id')
      .single()

    if (error || !data) {
      setErr(error?.message || 'Could not create subproject.')
      setSaving(false)
      return
    }
    router.replace(`/projects/${projectId}/subprojects/${data.id}`)
  }

  return (
    <>
      <Nav />
      <div className="max-w-xl mx-auto px-6 py-10">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-2 text-xs text-[#6B7280] hover:text-[#111] mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {projectName || 'Back to project'}
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight text-[#111] mb-1">New subproject</h1>
        <p className="text-sm text-[#6B7280] mb-6">
          Subprojects are the rooms or pieces of the job. Name it, pick the
          activity, and we'll drop you into the line editor.
        </p>

        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
          <label className="block">
            <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Name</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create() }}
              placeholder="e.g. Kitchen cabinets · Master vanity · Library built-ins"
              className="mt-1 w-full px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
            />
          </label>

          <div className="mt-4">
            <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Activity</div>
            <div className="grid grid-cols-2 gap-1.5">
              {ACTIVITY_TYPES.map((a) => {
                const on = activity === a.key
                return (
                  <button
                    key={a.key}
                    onClick={() => setActivity(a.key)}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${on ? 'bg-[#EFF6FF] border-[#2563EB] text-[#111]' : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#9CA3AF]'}`}
                  >
                    <div className="font-medium">{a.label}</div>
                    <div className="text-[11px] text-[#9CA3AF]">{a.hint}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {err && (
            <div className="mt-4 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#B91C1C]">
              {err}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <Link
              href={`/projects/${projectId}`}
              className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] rounded-lg"
            >
              Cancel
            </Link>
            <button
              onClick={create}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Continue to editor'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-4 text-[11px] text-[#9CA3AF] text-center">
          Tip: press <kbd className="px-1.5 py-0.5 bg-white border border-[#E5E7EB] rounded font-mono">⏎</kbd> to save.
        </div>
      </div>
    </>
  )
}
