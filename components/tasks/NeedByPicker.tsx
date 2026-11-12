'use client'

// ============================================================================
// NeedByPicker — the quick-pick chips that STAMP A DATE (migration 132)
// ============================================================================
// Today · This week · Next week · In 2 weeks · Pick a date · Someday. The
// chips are shortcuts, not storage: each writes a need_by (lib/tasks
// needByForPick). A chip lights when the date equals what it would stamp
// today; a hand-picked date lights the date field instead. Used by every
// create and the row editor so the three can't drift.
// ============================================================================

import { localISO, needByForPick, pickForNeedBy, PICK_LABEL, TASK_PICKS } from '@/lib/tasks'

export default function NeedByPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null
  onChange: (needBy: string | null) => void
  disabled?: boolean
}) {
  const today = localISO()
  const lit = pickForNeedBy(value, today)
  const chip = (on: boolean) =>
    `text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
      on ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
    }`
  const picks = TASK_PICKS.filter((p) => p !== 'someday')
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {picks.map((p) => (
        <button key={p} disabled={disabled} onClick={() => onChange(needByForPick(p, today))} className={chip(lit === p)}>
          {PICK_LABEL[p]}
        </button>
      ))}
      <label className={`${chip(!!value && !lit)} inline-flex items-center gap-1 cursor-pointer`}>
        <span>{value && !lit ? value.slice(5).replace('-', '/') : 'Pick a date'}</span>
        <input
          type="date"
          disabled={disabled}
          value={value ?? ''}
          min={today}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="w-0 h-0 opacity-0 absolute"
          onClick={(e) => (e.currentTarget as HTMLInputElement).showPicker?.()}
        />
      </label>
      <button disabled={disabled} onClick={() => onChange(null)} className={chip(lit === 'someday')}>
        {PICK_LABEL.someday}
      </button>
    </div>
  )
}
