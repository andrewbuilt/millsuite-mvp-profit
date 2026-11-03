'use client'

// ============================================================================
// HandoffCard — the sales → shop handoff sheet, on the pre-production page
// ============================================================================
// November item 3 (125), modeled on the Luka project sheet: who to call, where
// the job is, when the client needs it, how to get in. The first three gate
// production (lib/handoff); site access is reference only.
//
// Each field saves on blur — no Save button to forget — and a refused write is
// said beside the field, not swallowed. `onSaved` lets the page re-run its
// gates so the What's-left rail and the Start button move as you type.
// ============================================================================

import { useEffect, useState } from 'react'
import { handoffMissing, saveHandoffField, type HandoffField, type HandoffFields } from '@/lib/handoff'

const ROWS: Array<{
  field: HandoffField
  label: string
  placeholder: string
  type?: 'tel' | 'email'
  multiline?: boolean
}> = [
  { field: 'poc_name', label: 'Point of contact', placeholder: 'Who we call on site' },
  { field: 'poc_phone', label: 'Phone', placeholder: '(555) 555-0100', type: 'tel' },
  { field: 'poc_email', label: 'Email', placeholder: 'name@example.com', type: 'email' },
  { field: 'delivery_address', label: 'Jobsite address', placeholder: 'Street, city' },
  { field: 'client_deadline', label: 'Client deadline', placeholder: 'A date, or "ASAP"' },
  {
    field: 'site_access_notes',
    label: 'Site access',
    placeholder: 'Gate / keypad codes, parking, elevator, who lets us in…',
    multiline: true,
  },
]

export default function HandoffCard({
  projectId,
  values,
  onSaved,
}: {
  projectId: string
  values: HandoffFields
  onSaved: (field: HandoffField, value: string | null) => void
}) {
  const gaps = handoffMissing(values)
  const missing = new Set<HandoffField>([
    ...(gaps.includes('contact')
      ? (['poc_name', 'poc_phone', 'poc_email'] as HandoffField[]).filter((f) =>
          f === 'poc_name' ? !values.poc_name?.trim() : !values.poc_phone?.trim() && !values.poc_email?.trim(),
        )
      : []),
    ...(gaps.includes('address') ? (['delivery_address'] as HandoffField[]) : []),
    ...(gaps.includes('deadline') ? (['client_deadline'] as HandoffField[]) : []),
  ])

  return (
    <section id="handoff" className="bg-white border border-[#E5E7EB] rounded-2xl mb-4 overflow-hidden scroll-mt-24">
      <div className="flex items-center justify-between gap-4 px-[18px] py-3.5 border-b border-[#F3F4F6]">
        <div>
          <div className="text-[15px] font-semibold text-[#111]">Handoff</div>
          <div className="text-[12px] text-[#9CA3AF] mt-px">
            What the shop needs from sales before production starts.
          </div>
        </div>
        <span
          className={
            'text-[11px] font-semibold px-2.5 py-1 rounded-full border ' +
            (gaps.length === 0
              ? 'text-[#065F46] bg-[#ECFDF5] border-[#A7F3D0]'
              : 'text-[#92400E] bg-[#FFFBEB] border-[#FDE68A]')
          }
        >
          {values.imported_at ? 'Imported job · not required' : gaps.length === 0 ? 'Complete ✓' : `${gaps.length} to fill`}
        </span>
      </div>
      <div className="px-[18px] py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
        {ROWS.map((r) => (
          <HandoffInput
            key={r.field}
            projectId={projectId}
            row={r}
            value={(values[r.field] as string | null | undefined) ?? ''}
            missing={missing.has(r.field)}
            onSaved={onSaved}
          />
        ))}
      </div>
      <div className="px-[18px] pb-3 text-[11px] text-[#9CA3AF]">
        Contact (a name and a phone or email), jobsite address and deadline are required to start
        production.
      </div>
    </section>
  )
}

function HandoffInput({
  projectId,
  row,
  value,
  missing,
  onSaved,
}: {
  projectId: string
  row: (typeof ROWS)[number]
  value: string
  missing: boolean
  onSaved: (field: HandoffField, value: string | null) => void
}) {
  const [draft, setDraft] = useState(value)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setDraft(value), [value])

  async function commit() {
    if (draft.trim() === value.trim()) return
    setState('saving')
    setErr(null)
    try {
      await saveHandoffField(projectId, row.field, draft)
      setState('saved')
      onSaved(row.field, draft.trim() || null)
      setTimeout(() => setState('idle'), 1500)
    } catch (e) {
      setState('idle')
      setErr(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  const cls =
    'w-full px-2.5 py-1.5 text-[13px] rounded-lg border bg-white text-[#111] placeholder:text-[#C4C8CE] focus:outline-none focus:border-[#2563EB] ' +
    (missing ? 'border-[#FCD34D] bg-[#FFFBEB]' : 'border-[#E5E7EB]')

  return (
    <label className={'block ' + (row.multiline ? 'sm:col-span-2' : '')}>
      <span className="flex items-center justify-between text-[11px] text-[#6B7280] mb-1">
        <span>
          {row.label}
          {missing && <span className="ml-1 text-[#B45309]">· needed</span>}
        </span>
        <span className="text-[10.5px] text-[#9CA3AF]">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}
        </span>
      </span>
      {row.multiline ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          placeholder={row.placeholder}
          rows={3}
          className={cls + ' resize-y'}
        />
      ) : (
        <input
          type={row.type ?? 'text'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          placeholder={row.placeholder}
          className={cls}
        />
      )}
      {err && <span className="block mt-1 text-[11px] text-[#B91C1C]">{err}</span>}
    </label>
  )
}
