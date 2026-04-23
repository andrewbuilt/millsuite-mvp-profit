'use client'

// ============================================================================
// InstallPrefill — subproject-header install cost block.
// ============================================================================
// Per BUILD-ORDER Phase 12 item 9 + specs/add-line-composer/README.md.
//
// Three inputs (guys / days / complexity %) + computed cost display.
// Shop install rate comes in as a prop so the computed cost responds to
// ShopRateWalkthrough changes the same way cabinet labor does. Persists
// to subprojects.install_* on blur; parent provides onChange so the
// subproject editor can re-roll its displayed total immediately.
//
// Description lists typical complexity-markup reasons per spec — one
// number, one decision, no checkbox matrix to maintain.
// ============================================================================

import { useEffect, useState } from 'react'
import {
  computeInstallCost,
  computeInstallHours,
  emptyInstallPrefill,
  loadInstallPrefill,
  saveInstallPrefill,
  type InstallPrefill as InstallPrefillValues,
} from '@/lib/install-prefill'

interface Props {
  subprojectId: string
  installRatePerHour: number
  /** Fires with the latest values whenever the user commits (blur or
   *  stepper click) so the subproject editor can update its total. */
  onChange?: (prefill: InstallPrefillValues) => void
}

function fmtMoney(n: number): string {
  if (!n || n === 0) return '$0'
  return '$' + Math.round(n).toLocaleString()
}

export default function InstallPrefill({ subprojectId, installRatePerHour, onChange }: Props) {
  const [values, setValues] = useState<InstallPrefillValues>(emptyInstallPrefill())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const v = await loadInstallPrefill(subprojectId)
        if (cancelled) return
        setValues(v)
        onChange?.(v)
      } catch (err) {
        console.error('loadInstallPrefill', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subprojectId])

  const hours = computeInstallHours(values)
  const cost = computeInstallCost(values, installRatePerHour)
  const base = hours * (Number(installRatePerHour) || 0)
  const complexityAmount = cost - base

  function set<K extends keyof InstallPrefillValues>(key: K, raw: string) {
    const v = raw === '' ? null : Number(raw)
    const next = Number.isFinite(v as number) && (v as number) >= 0 ? v : null
    setValues((prev) => ({ ...prev, [key]: next as InstallPrefillValues[K] }))
  }
  function step<K extends keyof InstallPrefillValues>(key: K, delta: number) {
    setValues((prev) => {
      const cur = Number(prev[key]) || 0
      const next = Math.max(0, cur + delta)
      return { ...prev, [key]: next as InstallPrefillValues[K] }
    })
  }

  async function persist() {
    setSaving(true)
    setError(null)
    try {
      await saveInstallPrefill(subprojectId, values)
      onChange?.(values)
    } catch (err: any) {
      setError(err?.message || 'Failed to save install prefill')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Install prefill
          </div>
          <div className="text-[11.5px] text-[#9CA3AF]">
            Guys × days × ${Number(installRatePerHour) || 0}/hr × (1 + complexity%).
            Complexity markup covers <em>elevator access, 2nd-floor stairs, long carry, tight stairwell, historic building, occupied residence, etc.</em> One number, no checkbox matrix.
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Install cost
          </div>
          <div className="text-[18px] font-semibold text-[#111] font-mono tabular-nums">
            {fmtMoney(cost)}
          </div>
          {hours > 0 && (
            <div className="text-[11px] text-[#9CA3AF] font-mono tabular-nums">
              {hours.toFixed(1)} hr · {fmtMoney(base)} base
              {complexityAmount > 0 && ` + ${fmtMoney(complexityAmount)} markup`}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        <InputField
          label="Guys"
          hint="installers on the job"
          value={values.guys}
          step={1}
          onRaw={(v) => set('guys', v)}
          onStep={(d) => step('guys', d)}
          onBlur={persist}
          unit=""
          disabled={loading || saving}
        />
        <InputField
          label="Days"
          hint="estimated days on site"
          value={values.days}
          step={0.5}
          onRaw={(v) => set('days', v)}
          onStep={(d) => step('days', d)}
          onBlur={persist}
          unit=""
          disabled={loading || saving}
        />
        <InputField
          label="Complexity markup"
          hint="% over base — reasons above"
          value={values.complexityPct}
          step={5}
          onRaw={(v) => set('complexityPct', v)}
          onStep={(d) => step('complexityPct', d)}
          onBlur={persist}
          unit="%"
          disabled={loading || saving}
        />
      </div>

      {error && (
        <div className="mt-3 px-3 py-1.5 bg-[#FEF2F2] border border-[#FECACA] rounded-md text-[12px] text-[#991B1B]">
          {error}
        </div>
      )}
    </div>
  )
}

function InputField({
  label,
  hint,
  value,
  step,
  unit,
  onRaw,
  onStep,
  onBlur,
  disabled,
}: {
  label: string
  hint: string
  value: number | null
  step: number
  unit: string
  onRaw: (v: string) => void
  onStep: (delta: number) => void
  onBlur: () => void
  disabled: boolean
}) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
        {label}
      </div>
      <div className="text-[11px] text-[#9CA3AF] mb-1.5">{hint}</div>
      <div className="inline-flex items-center gap-1.5 w-full">
        <button
          type="button"
          onClick={() => {
            onStep(-step)
            onBlur()
          }}
          disabled={disabled || !value || value <= 0}
          className="w-7 h-7 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] disabled:opacity-40 text-sm"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="number"
          min="0"
          step={step}
          value={value == null ? '' : value}
          placeholder="0"
          disabled={disabled}
          onChange={(e) => onRaw(e.target.value)}
          onBlur={onBlur}
          className="flex-1 min-w-0 text-center font-mono tabular-nums text-sm px-2 py-1.5 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            onStep(step)
            onBlur()
          }}
          disabled={disabled}
          className="w-7 h-7 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] disabled:opacity-40 text-sm"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
        {unit && <span className="text-[11px] text-[#9CA3AF] ml-0.5">{unit}</span>}
      </div>
    </label>
  )
}
