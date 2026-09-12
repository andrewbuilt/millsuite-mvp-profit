'use client'

// ============================================================================
// SalesGoalCard — the three knobs behind the monthly cash target.
// ============================================================================
// Self-loading and self-saving so it doesn't have to thread three more pieces
// of state through a 1,900-line settings page.
//
// Andrew's model (2026-09-12): every dollar received splits into overhead,
// material and profit, so
//
//     goal = monthlyFixed / (1 - materialPct - profitPct)
//
// ⚠️ THIS IS NOT THE SAME AS "PROJECT DEFAULTS" ABOVE IT, and the two will be
// confused if they're not kept plainly apart. Those margins price a JOB (cost
// → price, per bucket). These percentages describe where the SHOP's revenue
// goes in aggregate, to work out how much revenue a month needs. Copying one
// into the other is wrong in both directions.
// ============================================================================

import { useEffect, useState } from 'react'
import { Target } from 'lucide-react'
import {
  computeGoal,
  deriveMonthlyFixed,
  suggestMaterialPct,
  MAX_COMBINED_PCT,
} from '@/lib/sales-goal'
import {
  loadGoalSettings,
  loadSoldJobMaterialSamples,
  saveGoalSettings,
} from '@/lib/sales-goal-data'
import {
  loadShopRateSetup,
  sumOverheadAnnual,
  sumTeamAnnualComp,
} from '@/lib/shop-rate-setup'

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/** '' ⇒ null. ⛔ Not `Number(v) || null` — that maps a legitimate 0 to null,
 *  and 0% material is a real answer for a shop that buys nothing. */
function toNum(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export default function SalesGoalCard({
  orgId,
  consumableMarkupPct,
}: {
  orgId: string | undefined
  /** `orgs.consumable_markup_pct`. Consumables in the goal are derived from
   *  it rather than asked for — see the header of lib/sales-goal. */
  consumableMarkupPct: number
}) {
  const [material, setMaterial] = useState('')
  const [profit, setProfit] = useState('')
  const [override, setOverride] = useState('')
  const [derivedFixed, setDerivedFixed] = useState(0)
  const [suggested, setSuggested] = useState<number | null>(null)
  const [sampleCount, setSampleCount] = useState(0)
  const [considered, setConsidered] = useState(0)
  /** Overhead categories that also live inside the material+consumables
   *  percentage. Non-empty ⇒ the goal is double-counting them. */
  const [overlapCategories, setOverlapCategories] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      // ⛔ SETTLE EACH ONE. `loadShopRateSetup` throws (it uses .single(), so
      // a transient failure or a missing row rejects). In a Promise.all that
      // rejection skipped `setLoaded(true)` and the card sat on "Loading…"
      // forever, with no error and no Save button — the worst failure shape
      // available, because it looks like the feature is simply slow.
      const settings = await loadGoalSettings(orgId).catch(() => null)
      const setup = await loadShopRateSetup(orgId).catch(() => null)
      const samples = await loadSoldJobMaterialSamples(orgId).catch(() => ({
        samples: [],
        considered: 0,
      }))
      if (cancelled) return

      if (!settings) {
        setError('Could not load the goal settings. Reload to try again.')
        setLoaded(true)
        return
      }

      setMaterial(settings.materialPct == null ? '' : String(settings.materialPct))
      setProfit(settings.profitPct == null ? '' : String(settings.profitPct))
      setOverride(
        settings.fixedMonthlyOverride == null ? '' : String(settings.fixedMonthlyOverride),
      )
      setMissing(settings.missing)
      setDerivedFixed(
        setup
          ? deriveMonthlyFixed(sumOverheadAnnual(setup.overhead), sumTeamAnnualComp(setup.team))
          : 0,
      )

      // ⛔ THE ONE HAZARD IN FOLDING CONSUMABLES INTO THE MATERIAL %. If the
      // shop also carries a consumables line in OVERHEAD, that money is in
      // `monthlyFixed` AND in the percentage, and the goal reads high. Named
      // categories, not a guess: these are the two that ship in
      // DEFAULT_OVERHEAD_CATEGORIES.
      if (setup) {
        const doubled = Object.entries(setup.overhead || {})
          .filter(([name, input]) => {
            const n = name.toLowerCase()
            const hasMoney = (Number(input?.amount) || 0) > 0
            return hasMoney && (n.includes('consumable') || n.includes('tool'))
          })
          .map(([name]) => name)
        setOverlapCategories(doubled)
      }
      setSuggested(suggestMaterialPct(samples.samples))
      setSampleCount(samples.samples.length)
      setConsidered(samples.considered)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function save() {
    if (!orgId) return
    setSaving(true)
    setError(null)
    try {
      await saveGoalSettings(orgId, {
        materialPct: toNum(material),
        profitPct: toNum(profit),
        fixedMonthlyOverride: toNum(override),
      })
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 2400)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save. If this org predates migration 101, run it first.',
      )
    } finally {
      setSaving(false)
    }
  }

  const monthlyFixed = toNum(override) ?? derivedFixed
  const preview = computeGoal({
    monthlyFixed,
    materialPct: toNum(material),
    profitPct: toNum(profit),
    consumableMarkupPct,
  })

  const inputClass =
    'w-24 px-2.5 py-1.5 text-sm font-mono text-right border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]'

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center gap-2">
        <Target className="w-4 h-4 text-[#2563EB]" />
        <div>
          <h2 className="text-base font-semibold">Sales goal</h2>
          <p className="text-xs text-[#9CA3AF] mt-0.5">
            How much cash a month has to bring in to cover the shop. Shown on
            Payments and on your day.
          </p>
        </div>
      </div>

      {missing ? (
        <div className="px-6 py-4 text-[12.5px] text-[#92400E]">
          Needs migration <code>101</code>. Until it runs, the goal can&rsquo;t be
          saved and Payments shows a running total instead of a target.
        </div>
      ) : !loaded ? (
        <div className="px-6 py-4 text-[12.5px] text-[#9CA3AF] italic">Loading…</div>
      ) : (
        <div className="px-6 py-4">
          {/* Fixed cost — derived, overridable */}
          <div className="flex items-start justify-between py-3 gap-4">
            <label className="text-sm text-[#6B7280]">
              Monthly fixed cost
              <span className="block text-[11px] text-[#9CA3AF] leading-snug mt-0.5">
                Derived from overhead + team pay: <strong>{money(derivedFixed)}</strong>/mo.
                {' '}Leave blank to keep it in step with those; type a number to pin it.
              </span>
            </label>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-sm text-[#9CA3AF]">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={override}
                placeholder={String(Math.round(derivedFixed))}
                onChange={(e) => setOverride(e.target.value.replace(/[^0-9.]/g, ''))}
                className={inputClass}
              />
            </div>
          </div>

          {/* Material % */}
          <div className="flex items-start justify-between py-3 border-t border-[#F3F4F6] gap-4">
            <label className="text-sm text-[#6B7280]">
              Material share of revenue
              <span className="block text-[11px] text-[#9CA3AF] leading-snug mt-0.5">
                {/* ⛔ MATERIAL ONLY. Consumables are added on top from the
                    markup — widening this to "everything bought" would
                    charge for them twice. */}
                {preview.consumablesPct > 0 && (
                  <span className="block mb-0.5 text-[#6B7280]">
                    Consumables add{' '}
                    <strong>{preview.consumablesPct.toFixed(1)}%</strong> on top
                    automatically ({material || 0}% × your {consumableMarkupPct}%
                    markup) — no need to include them here.
                  </span>
                )}
                {suggested != null ? (
                  <>
                    {/* ⛔ SAY WHAT WAS ACTUALLY MEASURED. This read "your last
                        3 jobs" when it meant "3 of the last 10 finished jobs
                        had bills entered" — which invites the reader to trust
                        a sample that isn't what they think it is. */}
                    {sampleCount === considered
                      ? `Your last ${sampleCount} finished ${sampleCount === 1 ? 'job' : 'jobs'} averaged `
                      : `${sampleCount} of your last ${considered} finished jobs have vendor bills entered; those averaged `}
                    <strong>{suggested}%</strong>.{' '}
                    {/* Suggests, never applies (Andrew, v1). */}
                    <button
                      type="button"
                      onClick={() => setMaterial(String(suggested))}
                      className="text-[#2563EB] hover:underline"
                    >
                      Use it
                    </button>
                  </>
                ) : (
                  /* ⛔ FINISHED jobs only. Bills arrive across a job's life, so
                     an in-flight job has all of its price and only some of its
                     material — sampling those understated material badly. */
                  'No completed jobs with vendor bills yet, so there’s nothing to suggest from.'
                )}
              </span>
            </label>
            <div className="flex items-center gap-1 flex-shrink-0">
              <input
                type="text"
                inputMode="decimal"
                value={material}
                onChange={(e) => setMaterial(e.target.value.replace(/[^0-9.]/g, ''))}
                className={inputClass}
              />
              <span className="text-sm text-[#9CA3AF]">%</span>
            </div>
          </div>

          {/* Profit % */}
          <div className="flex items-start justify-between py-3 border-t border-[#F3F4F6] gap-4">
            <label className="text-sm text-[#6B7280]">
              Target profit
              <span className="block text-[11px] text-[#9CA3AF] leading-snug mt-0.5">
                Assumed, blended across the shop — real profit isn&rsquo;t known
                until a job closes.
              </span>
            </label>
            <div className="flex items-center gap-1 flex-shrink-0">
              <input
                type="text"
                inputMode="decimal"
                value={profit}
                onChange={(e) => setProfit(e.target.value.replace(/[^0-9.]/g, ''))}
                className={inputClass}
              />
              <span className="text-sm text-[#9CA3AF]">%</span>
            </div>
          </div>

          {/* Live preview of what they just typed */}
          <div className="mt-3 pt-3 border-t border-[#F3F4F6]">
            {preview.status === 'ok' ? (
              <div className="text-[13px] text-[#111]">
                Monthly goal:{' '}
                <strong className="font-mono tabular-nums">{money(preview.amount)}</strong>
                <span className="block text-[11px] text-[#9CA3AF] mt-0.5 font-mono">
                  {money(monthlyFixed)} ÷ (1 − {preview.materialPct}%
                  {preview.consumablesPct > 0
                    ? ` − ${preview.consumablesPct.toFixed(1)}%`
                    : ''}{' '}
                  − {preview.profitPct}%)
                </span>
              </div>
            ) : preview.status === 'negative' ? (
              <div className="text-[12.5px] text-[#92400E]">
                Percentages can&rsquo;t be negative.
              </div>
            ) : preview.status === 'impossible' ? (
              <div className="text-[12.5px] text-[#92400E]">
                Material and profit have to stay under {MAX_COMBINED_PCT}% together
                — past that there&rsquo;s too little of each dollar left for
                overhead and the goal runs away to infinity.
              </div>
            ) : preview.status === 'no_fixed' ? (
              <div className="text-[12.5px] text-[#92400E]">
                No overhead or team pay is set up yet, so there&rsquo;s no fixed
                cost to cover. Fill in the shop-rate inputs above, or pin a
                monthly figure here.
              </div>
            ) : (
              <div className="text-[12.5px] text-[#9CA3AF]">
                Set both percentages to see the goal.
              </div>
            )}
          </div>

          {/* Shown regardless of whether a goal is set up — it's a statement
              about the INPUTS, and it's the reason the goal would read high. */}
          {overlapCategories.length > 0 && (
            <div className="mt-3 text-[12px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2 leading-snug">
              <strong>Counted twice:</strong> {overlapCategories.join(' and ')}{' '}
              {overlapCategories.length === 1 ? 'is' : 'are'} in your monthly
              overhead above, and consumables are also inside the percentage
              below — so the goal asks you to cover them from both sides and
              comes out high. Either drop{' '}
              {overlapCategories.length === 1 ? 'that line' : 'those lines'} from
              overhead, or keep the percentage to material only.
            </div>
          )}

          {error && (
            <div className="mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save goal'}
            </button>
            {savedAt && <span className="text-[12px] text-[#059669]">Saved</span>}
          </div>
        </div>
      )}
    </div>
  )
}
