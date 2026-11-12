'use client'

// ============================================================================
// NeedByPicker — the quick-pick chips that STAMP A DATE (132) + Critical (133)
// ============================================================================
// Critical · Today · This week · Next week · Pick a date (Andrew, 2026-11-12:
// "In 2 weeks" and "Someday" dropped). The chips are shortcuts, not storage:
// each writes a need_by (lib/tasks needByForPick). Critical is exclusive with
// the date chips — it stamps today AND sets the flag; picking any date clears
// the flag. A chip lights when the date equals what it would stamp today; a
// hand-picked date lights the date field instead. Used by every create and
// the task detail so they can't drift.
// ============================================================================

import { AlertTriangle } from 'lucide-react'
import { localISO, needByForPick, OFFERED_PICKS, pickForNeedBy, PICK_LABEL } from '@/lib/tasks'

export default function NeedByPicker({
  value,
  critical = false,
  onChange,
  disabled,
  size = 'sm',
}: {
  value: string | null
  critical?: boolean
  onChange: (needBy: string | null, critical: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const today = localISO()
  const lit = critical ? null : pickForNeedBy(value, today)
  const pad = size === 'md' ? 'text-[12.5px] px-2.5 py-1 rounded-lg' : 'text-[11px] px-2 py-0.5 rounded-md'
  const chip = (on: boolean) =>
    `${pad} border transition-colors ${
      on ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
    }`
  const handPicked = !critical && !!value && !lit
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(today, true)}
        className={`${pad} border inline-flex items-center gap-1 transition-colors ${
          critical
            ? 'bg-[#DC2626] text-white border-[#DC2626]'
            : 'bg-white text-[#B91C1C] border-[#FECACA] hover:bg-[#FEF2F2]'
        }`}
      >
        <AlertTriangle className="w-3 h-3" /> Critical
      </button>
      {OFFERED_PICKS.map((p) => (
        <button
          key={p}
          type="button"
          disabled={disabled}
          onClick={() => onChange(needByForPick(p, today), false)}
          className={chip(lit === p)}
        >
          {PICK_LABEL[p]}
        </button>
      ))}
      <label className={`${chip(handPicked)} relative inline-flex items-center gap-1 cursor-pointer`}>
        <span>{handPicked && value ? value.slice(5).replace('-', '/') : 'Pick a date'}</span>
        <input
          type="date"
          disabled={disabled}
          value={value ?? ''}
          min={today}
          onChange={(e) => e.target.value && onChange(e.target.value, false)}
          className="w-0 h-0 opacity-0 absolute"
          onClick={(e) => (e.currentTarget as HTMLInputElement).showPicker?.()}
        />
      </label>
    </div>
  )
}
