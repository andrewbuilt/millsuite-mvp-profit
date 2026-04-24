'use client'

// components/walkthroughs/ShopRateWalkthrough.tsx
// Four-screen first-principles shop rate setup.
// Spec: mockups/shop-rate-setup-mockup.html (canonical). BUILD-ORDER Phase 12 item 12.
//
// Screens:
//   1. Overhead   - categorized $ inputs, monthly or annual.
//   2. Team       - add-row list, name + annual comp per employee.
//   3. Billable   - hrs/wk × weeks/yr × utilization%.
//   4. Result     - derived shop rate + Update / Keep buttons on re-entry.
//
// Persistence:
//   Each Continue saves that screen's input group to its jsonb column so
//   a mid-flow tab close loses nothing. The Result screen is the only
//   one that writes orgs.shop_rate.
//
// Contract:
//   orgId       - caller resolves org id.
//   onComplete  - fired after Result writes shop_rate.
//   onCancel    - optional. Shown as Back link on Screen 1.

import { useEffect, useMemo, useState } from 'react'
import {
  computeBillableHoursYear,
  computeDerivedShopRate,
  countBillable,
  defaultBillableHoursInputs,
  emptyOverheadInputs,
  loadShopRateSetup,
  makeTeamMember,
  saveShopRate,
  saveShopRateInputs,
  sumOverheadAnnual,
  sumTeamAnnualComp,
  type BillableHoursInputs,
  type OverheadInput,
  type OverheadInputs,
  type Period,
  type TeamMember,
} from '@/lib/shop-rate-setup'

interface Props {
  orgId: string
  onComplete: () => void
  onCancel?: () => void
}

type Screen = 'overhead' | 'team' | 'billable' | 'result'

function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  return '$' + Math.round(n).toLocaleString()
}

function fmtRate(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0/hr'
  return '$' + n.toFixed(2) + '/hr'
}

export default function ShopRateWalkthrough({ orgId, onComplete, onCancel }: Props) {
  const [screen, setScreen] = useState<Screen>('overhead')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [overhead, setOverhead] = useState<OverheadInputs>(emptyOverheadInputs())
  const [team, setTeam] = useState<TeamMember[]>([])
  const [billable, setBillable] = useState<BillableHoursInputs>(defaultBillableHoursInputs())
  const [currentShopRate, setCurrentShopRate] = useState(0)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const setup = await loadShopRateSetup(orgId)
        if (cancelled) return
        setOverhead(setup.overhead)
        setTeam(setup.team)
        setBillable(setup.billable)
        setCurrentShopRate(setup.shopRate)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load shop rate setup')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function advance(next: Screen, persist: () => Promise<void>) {
    setError(null)
    setSaving(true)
    try {
      await persist()
      setScreen(next)
    } catch (err: any) {
      setError(err?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-[620px] mx-auto bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
        <div className="text-sm text-[#9CA3AF] italic py-10 text-center">
          Loading shop rate inputs…
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[620px] w-full mx-auto bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
      <StepHeader screen={screen} />

      {error && (
        <div className="mb-4 px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      {screen === 'overhead' && (
        <OverheadScreen
          value={overhead}
          onChange={setOverhead}
          onContinue={() =>
            advance('team', () => saveShopRateInputs(orgId, { overhead }))
          }
          onCancel={onCancel}
          saving={saving}
        />
      )}

      {screen === 'team' && (
        <TeamScreen
          value={team}
          onChange={setTeam}
          onContinue={() =>
            advance('billable', () => saveShopRateInputs(orgId, { team }))
          }
          onBack={() => setScreen('overhead')}
          saving={saving}
        />
      )}

      {screen === 'billable' && (
        <BillableScreen
          value={billable}
          team={team}
          onChange={setBillable}
          onContinue={() =>
            advance('result', () => saveShopRateInputs(orgId, { billable }))
          }
          onBack={() => setScreen('team')}
          saving={saving}
        />
      )}

      {screen === 'result' && (
        <ResultScreen
          overhead={overhead}
          team={team}
          billable={billable}
          currentShopRate={currentShopRate}
          saving={saving}
          onBack={() => setScreen('billable')}
          onUseRate={async (rate) => {
            setError(null)
            setSaving(true)
            try {
              await saveShopRate(orgId, rate)
              onComplete()
            } catch (err: any) {
              setError(err?.message || 'Save failed')
              setSaving(false)
            }
          }}
        />
      )}
    </div>
  )
}

// ── Step header ──

function StepHeader({ screen }: { screen: Screen }) {
  const label = {
    overhead: '1 of 4 · Overhead',
    team: '2 of 4 · Team',
    billable: '3 of 4 · Billable hours',
    result: '4 of 4 · Your shop rate',
  }[screen]
  return (
    <div className="mb-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-1.5">
        {label}
      </div>
    </div>
  )
}

// ── Screen 1: Overhead ──

function OverheadScreen({
  value,
  onChange,
  onContinue,
  onCancel,
  saving,
}: {
  value: OverheadInputs
  onChange: (v: OverheadInputs) => void
  onContinue: () => void
  onCancel?: () => void
  saving: boolean
}) {
  const [newCategory, setNewCategory] = useState('')
  const entries = Object.entries(value)
  const total = sumOverheadAnnual(value)

  function updateRow(cat: string, patch: Partial<OverheadInput>) {
    onChange({ ...value, [cat]: { ...value[cat], ...patch } })
  }

  function removeRow(cat: string) {
    const next = { ...value }
    delete next[cat]
    onChange(next)
  }

  function renameRow(oldCat: string, newCat: string) {
    if (!newCat || newCat === oldCat || value[newCat]) return
    const next: OverheadInputs = {}
    for (const [k, v] of Object.entries(value)) {
      next[k === oldCat ? newCat : k] = v
    }
    onChange(next)
  }

  function addRow() {
    const name = newCategory.trim()
    if (!name || value[name]) return
    onChange({ ...value, [name]: { amount: 0, period: 'monthly' } })
    setNewCategory('')
  }

  return (
    <div>
      <h2 className="text-[20px] font-semibold text-[#111] tracking-tight mb-2">
        What does it cost to run your shop?
      </h2>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
        Every cost not tied to a specific job. Enter each one monthly or
        annual. The math works either way. Skip what doesn't apply.
      </p>

      <div className="space-y-2 mb-4">
        {entries.map(([cat, input]) => (
          <OverheadRow
            key={cat}
            category={cat}
            input={input}
            onAmount={(amount) => updateRow(cat, { amount })}
            onPeriod={(period) => updateRow(cat, { period })}
            onRename={(next) => renameRow(cat, next)}
            onRemove={() => removeRow(cat)}
            disabled={saving}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 mb-5">
        <input
          type="text"
          placeholder="+ Add category"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addRow()
            }
          }}
          className="flex-1 text-sm px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
          disabled={saving}
        />
        <button
          type="button"
          onClick={addRow}
          disabled={saving || !newCategory.trim()}
          className="text-sm text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-40 font-medium"
        >
          Add
        </button>
      </div>

      <div className="flex items-center justify-between px-4 py-3 bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg mb-5">
        <span className="text-sm text-[#6B7280]">Annual overhead</span>
        <span className="text-[15px] font-semibold font-mono tabular-nums text-[#111]">
          {fmtMoney(total)}
        </span>
      </div>

      <FooterButtons
        backLabel={onCancel ? '← Back' : undefined}
        onBack={onCancel}
        onContinue={onContinue}
        saving={saving}
        continueDisabled={saving}
      />
    </div>
  )
}

function OverheadRow({
  category,
  input,
  onAmount,
  onPeriod,
  onRename,
  onRemove,
  disabled,
}: {
  category: string
  input: OverheadInput
  onAmount: (n: number) => void
  onPeriod: (p: Period) => void
  onRename: (next: string) => void
  onRemove: () => void
  disabled: boolean
}) {
  const [name, setName] = useState(category)
  useEffect(() => {
    setName(category)
  }, [category])

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim()
          if (trimmed && trimmed !== category) onRename(trimmed)
          else setName(category)
        }}
        disabled={disabled}
        className="flex-1 min-w-0 text-sm px-2 py-1 bg-transparent focus:bg-white border border-transparent focus:border-[#E5E7EB] rounded-md focus:outline-none"
      />
      <span className="text-sm text-[#6B7280]">$</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="1"
        value={input.amount || ''}
        placeholder="0"
        onChange={(e) =>
          onAmount(e.target.value === '' ? 0 : Number(e.target.value))
        }
        disabled={disabled}
        className="w-24 text-right font-mono tabular-nums text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
      />
      <select
        value={input.period}
        onChange={(e) => onPeriod(e.target.value as Period)}
        disabled={disabled}
        className="text-sm px-1.5 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
      >
        <option value="monthly">/ mo</option>
        <option value="annual">/ yr</option>
      </select>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${category}`}
        className="w-6 h-6 text-[#9CA3AF] hover:text-[#991B1B] text-lg leading-none"
      >
        ×
      </button>
    </div>
  )
}

// ── Screen 2: Team ──

function TeamScreen({
  value,
  onChange,
  onContinue,
  onBack,
  saving,
}: {
  value: TeamMember[]
  onChange: (v: TeamMember[]) => void
  onContinue: () => void
  onBack: () => void
  saving: boolean
}) {
  const total = sumTeamAnnualComp(value)
  const billableCount = value.filter((m) => m.billable).length

  function addMember() {
    onChange([...value, makeTeamMember('', 0, true)])
  }
  function updateMember(id: string, patch: Partial<TeamMember>) {
    onChange(value.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }
  function removeMember(id: string) {
    onChange(value.filter((m) => m.id !== id))
  }

  return (
    <div>
      <h2 className="text-[20px] font-semibold text-[#111] tracking-tight mb-2">
        Who's on payroll?
      </h2>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-2">
        Name + total annual pay per person. Convert hourly wages to annual
        before entering ($/hr × hrs/wk × weeks). Owner comp too: if you
        pay yourself, count it.
      </p>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
        <strong className="text-[#111]">Billable</strong> = does this
        person's time get billed to jobs? Owner admin time, office
        managers, bookkeepers = <strong>No</strong>. Everyone touching
        production (CNC, assembly, finish, install) = <strong>Yes</strong>.
        Non-billable people still count toward total cost; they just
        don't show up in the hours denominator.
      </p>

      <div className="space-y-2 mb-4">
        {value.length === 0 && (
          <div className="text-sm text-[#9CA3AF] italic py-4 text-center bg-[#F9FAFB] border border-dashed border-[#E5E7EB] rounded-lg">
            No team yet. Add your first member below.
          </div>
        )}
        {value.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-2 px-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg"
          >
            <input
              type="text"
              value={m.name}
              onChange={(e) => updateMember(m.id, { name: e.target.value })}
              placeholder="Name"
              disabled={saving}
              className="flex-1 min-w-0 text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
            />
            <span className="text-sm text-[#6B7280]">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1000"
              value={m.annual_comp || ''}
              placeholder="0"
              onChange={(e) =>
                updateMember(m.id, {
                  annual_comp: e.target.value === '' ? 0 : Number(e.target.value),
                })
              }
              disabled={saving}
              className="w-28 text-right font-mono tabular-nums text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
            />
            <span className="text-sm text-[#9CA3AF]">/ yr</span>
            <label className="flex items-center gap-1 text-[11px] text-[#6B7280]">
              <span className="hidden sm:inline">Billable</span>
              <select
                value={m.billable ? 'yes' : 'no'}
                onChange={(e) =>
                  updateMember(m.id, { billable: e.target.value === 'yes' })
                }
                disabled={saving}
                className="text-sm px-1.5 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
                aria-label={`${m.name || 'Team member'} billable`}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => removeMember(m.id)}
              disabled={saving}
              aria-label={`Remove ${m.name || 'team member'}`}
              className="w-6 h-6 text-[#9CA3AF] hover:text-[#991B1B] text-lg leading-none"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addMember}
        disabled={saving}
        className="text-sm text-[#2563EB] hover:text-[#1D4ED8] font-medium mb-5 disabled:opacity-40"
      >
        + Add team member
      </button>

      <div className="flex items-center justify-between px-4 py-3 bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg mb-5">
        <div>
          <div className="text-sm text-[#6B7280]">Annual team comp</div>
          <div className="text-[11.5px] text-[#9CA3AF]">
            {billableCount} billable · {value.length - billableCount} non-billable
          </div>
        </div>
        <span className="text-[15px] font-semibold font-mono tabular-nums text-[#111]">
          {fmtMoney(total)}
        </span>
      </div>

      <FooterButtons
        backLabel="← Back"
        onBack={onBack}
        onContinue={onContinue}
        saving={saving}
        continueDisabled={saving}
      />
    </div>
  )
}

// ── Screen 3: Billable hours ──

function BillableScreen({
  value,
  team,
  onChange,
  onContinue,
  onBack,
  saving,
}: {
  value: BillableHoursInputs
  team: TeamMember[]
  onChange: (v: BillableHoursInputs) => void
  onContinue: () => void
  onBack: () => void
  saving: boolean
}) {
  const rawBillable = team.filter((m) => m.billable).length
  const people = countBillable(team)
  const hours = computeBillableHoursYear(value, people)

  return (
    <div>
      <h2 className="text-[20px] font-semibold text-[#111] tracking-tight mb-2">
        How many hours do you actually bill?
      </h2>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
        Utilization is the honest part: rework, cleanup, watercooler sessions,
        waiting on materials. A 70% number is common for a small shop.
      </p>

      <div className="flex items-center justify-between px-4 py-2.5 bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg mb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF]">
            Billable people
          </div>
          <div className="text-[11.5px] text-[#1E3A8A]">
            From your team list (billable = Yes)
          </div>
        </div>
        <div className="text-right">
          <div className="text-[20px] font-semibold font-mono tabular-nums text-[#111]">
            {people}
          </div>
          {rawBillable === 0 && (
            <div className="text-[10.5px] text-[#92400E]">
              Floor of 1 applied (team empty)
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 mb-5">
        <BillableInput
          label="Hours per week"
          hint="per person"
          value={value.hrs_per_week}
          step={1}
          onChange={(n) => onChange({ ...value, hrs_per_week: n })}
          disabled={saving}
          unit="hr"
        />
        <BillableInput
          label="Working weeks per year"
          hint="52 minus holidays, PTO, shutdowns"
          value={value.weeks_per_year}
          step={1}
          onChange={(n) => onChange({ ...value, weeks_per_year: n })}
          disabled={saving}
          unit="wk"
        />
        <BillableInput
          label="Utilization"
          hint="% of hours actually billable"
          value={value.utilization_pct}
          step={5}
          onChange={(n) => onChange({ ...value, utilization_pct: n })}
          disabled={saving}
          unit="%"
        />
      </div>

      <div className="flex items-center justify-between px-4 py-3 bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg mb-5">
        <div>
          <div className="text-sm text-[#6B7280]">Billable hours / year</div>
          <div className="text-[11.5px] text-[#9CA3AF] font-mono">
            {people} × {value.hrs_per_week || 0} hr × {value.weeks_per_year || 0} wk × {value.utilization_pct || 0}%
          </div>
        </div>
        <span className="text-[15px] font-semibold font-mono tabular-nums text-[#111]">
          {Math.round(hours).toLocaleString()} hr
        </span>
      </div>

      <FooterButtons
        backLabel="← Back"
        onBack={onBack}
        onContinue={onContinue}
        saving={saving}
        continueDisabled={saving || hours <= 0}
      />
    </div>
  )
}

function BillableInput({
  label,
  hint,
  value,
  step,
  unit,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  value: number
  step: number
  unit: string
  onChange: (n: number) => void
  disabled: boolean
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
      <div className="flex-1">
        <div className="text-sm font-medium text-[#111]">{label}</div>
        <div className="text-[11.5px] text-[#9CA3AF]">{hint}</div>
      </div>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={value || ''}
        placeholder="0"
        onChange={(e) =>
          onChange(e.target.value === '' ? 0 : Number(e.target.value))
        }
        disabled={disabled}
        className="w-24 text-right font-mono tabular-nums text-sm px-2 py-1.5 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
      />
      <span className="text-sm text-[#9CA3AF] w-6">{unit}</span>
    </label>
  )
}

// ── Screen 4: Result ──

function ResultScreen({
  overhead,
  team,
  billable,
  currentShopRate,
  saving,
  onBack,
  onUseRate,
}: {
  overhead: OverheadInputs
  team: TeamMember[]
  billable: BillableHoursInputs
  currentShopRate: number
  saving: boolean
  onBack: () => void
  onUseRate: (rate: number) => void
}) {
  const derived = useMemo(
    () => computeDerivedShopRate(overhead, team, billable),
    [overhead, team, billable]
  )
  const annualOverhead = sumOverheadAnnual(overhead)
  const annualTeam = sumTeamAnnualComp(team)
  const people = countBillable(team)
  const hours = computeBillableHoursYear(billable, people)

  const [override, setOverride] = useState<string>('')
  const overrideNum = Number(override)
  const overrideValid = override !== '' && Number.isFinite(overrideNum) && overrideNum > 0

  const delta = Math.abs(derived - currentShopRate)
  const showBothOnReentry = currentShopRate > 0 && delta > 0.005

  return (
    <div>
      <h2 className="text-[20px] font-semibold text-[#111] tracking-tight mb-2">
        Your blended shop rate
      </h2>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
        Total cost to run the shop for a year, divided by the hours you bill.
        This is what an hour of your shop's time actually costs you.
      </p>

      <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-5 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
          Derived from current inputs
        </div>
        <div className="text-[36px] font-semibold font-mono tabular-nums text-[#111] leading-none mb-3">
          {fmtRate(derived)}
        </div>
        <div className="text-[11.5px] text-[#6B7280] leading-relaxed font-mono">
          (all payroll {fmtMoney(annualTeam)} + overhead {fmtMoney(annualOverhead)})
          <br />÷ ({people} billable × {billable.hrs_per_week || 0} hr × {billable.weeks_per_year || 0} wk × {billable.utilization_pct || 0}%)
          <br />= {Math.round(hours).toLocaleString()} billable hr / yr
        </div>
      </div>

      <p className="text-[12.5px] text-[#6B7280] leading-relaxed mb-5">
        <strong className="text-[#111] font-semibold">This is your baseline rate.</strong>{' '}
        You need to charge at least this much to keep the lights on. Profit
        margin is added at the project level, and a default margin can be
        saved in settings.
      </p>

      {showBothOnReentry && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-4 mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#92400E] mb-1.5">
            Your current shop rate
          </div>
          <div className="text-[20px] font-semibold font-mono tabular-nums text-[#111] mb-1">
            {fmtRate(currentShopRate)}
          </div>
          <div className="text-[12px] text-[#78350F]">
            The derived rate is different from what you're using today. Update
            to the derived rate, or keep what you have.
          </div>
        </div>
      )}

      <div className="border-t border-[#E5E7EB] pt-4 mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
          Override
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#6B7280]">$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            value={override}
            placeholder="Type a different rate"
            onChange={(e) => setOverride(e.target.value)}
            disabled={saving}
            className="flex-1 text-sm px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none font-mono tabular-nums"
          />
          <span className="text-sm text-[#9CA3AF]">/ hr</span>
        </div>
        <div className="text-[11.5px] text-[#9CA3AF] mt-1.5">
          Use this if you want to charge more or less than the derived number.
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
        >
          ← Back
        </button>

        <div className="flex items-center gap-2">
          {overrideValid ? (
            <button
              type="button"
              onClick={() => onUseRate(overrideNum)}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#111] text-white text-sm font-medium rounded-lg hover:bg-[#374151] disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : `Use ${fmtRate(overrideNum)}`}
            </button>
          ) : (
            <>
              {showBothOnReentry && (
                <button
                  type="button"
                  onClick={() => onUseRate(currentShopRate)}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-[#111] text-sm font-medium rounded-lg border border-[#E5E7EB] hover:bg-[#F3F4F6] disabled:opacity-50 transition-colors"
                >
                  Keep {fmtRate(currentShopRate)}
                </button>
              )}
              <button
                type="button"
                onClick={() => onUseRate(derived)}
                disabled={saving || derived <= 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving
                  ? 'Saving…'
                  : showBothOnReentry
                    ? `Update to ${fmtRate(derived)}`
                    : 'Save this as your shop rate'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared footer ──

function FooterButtons({
  backLabel,
  onBack,
  onContinue,
  saving,
  continueDisabled,
}: {
  backLabel?: string
  onBack?: () => void
  onContinue: () => void
  saving: boolean
  continueDisabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {onBack && backLabel ? (
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
        >
          {backLabel}
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onContinue}
        disabled={continueDisabled}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? 'Saving…' : 'Continue →'}
      </button>
    </div>
  )
}
