'use client'

// ============================================================================
// ShopRateWalkthrough — first-login per-department shop-rate capture
// ============================================================================
// Per BUILD-ORDER Phase 12 item 3. Single embeddable step: five numeric
// inputs (Engineering / CNC / Assembly / Finish / Install) — the per-dept
// rates the composer math reads at line compute.
//
// Data flow:
//   load  → listShopLaborRates(orgId). If a dept row is missing, seed
//           from DEFAULT_LABOR_RATES so the inputs aren't blank. No side
//           effects on load — the defaults only persist when the user
//           clicks Save.
//   save  → updateShopLaborRate per dept in parallel, then onComplete().
//
// Scope — deliberately small:
//   - No wage / overhead / billable-hours flow. The richer shop-rate-setup
//     flow at specs/shop-rate-setup/ is deferred; that spec computes a
//     single blended rate, but the composer's closed contract requires
//     per-dept rates. This component is the V1 per-dept form.
//   - No onboarding_step stamp. The parent overlay manages step state.
//   - No layout chrome (no sticky header, no back button). Meant to embed
//     inside the WelcomeOverlay (item 5) and later in a standalone
//     /settings/shop-rate page (follow-up).
//
// Contract — props:
//   orgId       — caller resolves org id (useAuth() inside the overlay).
//   onComplete  — fired after all five rows upsert successfully.
//   onCancel    — optional; shown as a ghost "Back" link when provided.
// ============================================================================

import { useEffect, useState } from 'react'
import {
  listShopLaborRates,
  updateShopLaborRate,
  laborRateMap,
} from '@/lib/rate-book-v2'
import {
  DEFAULT_LABOR_RATES,
  LABOR_DEPTS,
  LABOR_DEPT_LABEL,
  type LaborDept,
} from '@/lib/rate-book-seed'

interface Props {
  orgId: string
  onComplete: () => void
  onCancel?: () => void
}

export default function ShopRateWalkthrough({ orgId, onComplete, onCancel }: Props) {
  const [rates, setRates] = useState<Record<LaborDept, number>>(DEFAULT_LABOR_RATES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pull existing rows; any dept without a row keeps its DEFAULT_LABOR_RATES
  // value. The defaults are not persisted on load — only the user's saved
  // edits write back.
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const rows = await listShopLaborRates(orgId)
        if (cancelled) return
        const existing = laborRateMap(rows)
        // laborRateMap returns 0 for missing depts; fall back to defaults.
        const next: Record<LaborDept, number> = { ...DEFAULT_LABOR_RATES }
        for (const d of LABOR_DEPTS) {
          if (existing[d] > 0) next[d] = existing[d]
        }
        setRates(next)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load shop rates')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function save() {
    setError(null)
    setSaving(true)
    try {
      // Five tiny writes — parallel is fine, each row is its own upsert.
      await Promise.all(
        LABOR_DEPTS.map((d) => updateShopLaborRate(orgId, d, Number(rates[d]) || 0))
      )
      onComplete()
    } catch (err: any) {
      setError(err?.message || 'Failed to save shop rates')
    } finally {
      setSaving(false)
    }
  }

  const canSave = LABOR_DEPTS.every((d) => Number.isFinite(rates[d]) && rates[d] > 0)

  return (
    <div className="max-w-[540px] mx-auto bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
      <div className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-1.5">
          Step 1 · Shop rate
        </div>
        <h2 className="text-[22px] font-semibold text-[#111] tracking-tight mb-2">
          What does an hour of shop time cost?
        </h2>
        <p className="text-sm text-[#6B7280] leading-relaxed">
          One rate per department. These are what the composer multiplies
          against estimated hours. You can tweak them anytime from Settings.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-[#9CA3AF] italic py-6 text-center">
          Loading current rates…
        </div>
      ) : (
        <div className="space-y-2.5 mb-5">
          {LABOR_DEPTS.map((d) => (
            <div
              key={d}
              className="flex items-center justify-between gap-4 px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg"
            >
              <label htmlFor={`rate-${d}`} className="text-sm font-medium text-[#111]">
                {LABOR_DEPT_LABEL[d]}
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-[#6B7280]">$</span>
                <input
                  id={`rate-${d}`}
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min="0"
                  value={rates[d]}
                  onChange={(e) => {
                    const v = e.target.value
                    setRates((prev) => ({
                      ...prev,
                      [d]: v === '' ? 0 : Number(v),
                    }))
                  }}
                  className="w-24 text-right font-mono tabular-nums text-sm px-2.5 py-1.5 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
                  disabled={saving}
                />
                <span className="text-sm text-[#9CA3AF]">/ hr</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
          >
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving || loading || !canSave}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
