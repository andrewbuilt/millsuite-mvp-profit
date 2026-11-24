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
import { Plus, X } from 'lucide-react'
import {
  handoffMissing,
  loadHandoffContacts,
  saveHandoffContacts,
  saveHandoffField,
  type HandoffField,
  type HandoffFields,
} from '@/lib/handoff'
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABEL,
  MAX_HANDOFF_CONTACTS,
  newContactId,
  type ContactCategory,
  type HandoffContact,
} from '@/lib/handoff-contacts'

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
      <OtherContacts projectId={projectId} />
    </section>
  )
}

/**
 * The job's OTHER contacts (136) — GC, designer, architect… each filed under a
 * category. The point of contact above is still the one that gates; these are
 * reference, and they show on the client's approval portal too.
 *
 * Loads its own list (an isolated read — see lib/handoff loadHandoffContacts).
 * A row saves when you leave a field or change its category; a row with no
 * name yet stays on screen but isn't stored.
 */
function OtherContacts({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<HandoffContact[]>([])
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void loadHandoffContacts(projectId).then((c) => live && setRows(c))
    return () => {
      live = false
    }
  }, [projectId])

  async function persist(next: HandoffContact[]) {
    setState('saving')
    setErr(null)
    try {
      await saveHandoffContacts(projectId, next)
      setState('saved')
      setTimeout(() => setState('idle'), 1500)
    } catch (e) {
      setState('idle')
      setErr(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  const patch = (id: string, p: Partial<HandoffContact>) => rows.map((r) => (r.id === id ? { ...r, ...p } : r))
  const field =
    'w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-[#E5E7EB] bg-white text-[#111] placeholder:text-[#C4C8CE] focus:outline-none focus:border-[#2563EB]'

  return (
    <div className="px-[18px] py-3 border-t border-[#F3F4F6]" data-other-contacts>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-[#6B7280]">
          Other contacts <span className="text-[#9CA3AF]">· GC, designer, architect… shown to the client on the portal</span>
        </div>
        <span className="text-[10.5px] text-[#9CA3AF]">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}</span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} data-contact-row className="grid grid-cols-1 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
            <select
              value={r.category}
              aria-label="Contact category"
              onChange={(e) => {
                const next = patch(r.id, { category: e.target.value as ContactCategory })
                setRows(next)
                void persist(next)
              }}
              className={field + ' pr-6'}
            >
              {CONTACT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CONTACT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input
              value={r.name}
              placeholder="Name"
              aria-label="Contact name"
              onChange={(e) => setRows(patch(r.id, { name: e.target.value }))}
              onBlur={() => void persist(rows)}
              className={field}
            />
            <input
              value={r.phone ?? ''}
              placeholder="Phone"
              type="tel"
              aria-label="Contact phone"
              onChange={(e) => setRows(patch(r.id, { phone: e.target.value || null }))}
              onBlur={() => void persist(rows)}
              className={field}
            />
            <input
              value={r.email ?? ''}
              placeholder="Email"
              type="email"
              aria-label="Contact email"
              onChange={(e) => setRows(patch(r.id, { email: e.target.value || null }))}
              onBlur={() => void persist(rows)}
              className={field}
            />
            <button
              aria-label={`Remove ${r.name || 'contact'}`}
              onClick={() => {
                const next = rows.filter((x) => x.id !== r.id)
                setRows(next)
                void persist(next)
              }}
              className="w-7 h-7 rounded-lg text-[#9CA3AF] hover:text-[#B91C1C] hover:bg-[#FEF2F2] flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      {rows.length < MAX_HANDOFF_CONTACTS && (
        <button
          onClick={() => setRows([...rows, { id: newContactId(), category: 'gc', name: '', phone: null, email: null }])}
          className="mt-2 text-xs inline-flex items-center gap-1 text-[#2563EB] hover:underline"
        >
          <Plus className="w-3 h-3" /> Add contact
        </button>
      )}
      {err && <div className="mt-1 text-[11px] text-[#B91C1C]">{err}</div>}
    </div>
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
