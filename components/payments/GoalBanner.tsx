'use client'

// ============================================================================
// GoalBanner — this month's cash target vs what's actually landed.
// ============================================================================
// Andrew, 2026-09-12, on the old "Needed" figure: it summed the scheduled
// draws, which is "just adding up what is brought in, makes no sense." A
// target you compute from the plan can't tell you whether the plan is big
// enough. This is the target the shop's fixed costs actually demand.
//
// ⛔ GOAL IS MEASURED IN CASH RECEIVED, NOT BOOKINGS — Andrew's call. Signing
// a $200k job in March does not pay March's rent. The bar moves when money
// lands, which is the same definition /payments already uses for "received",
// so the two can't disagree.
//
// ⛔ AND IT NEVER GUESSES. Percentages unset, migration not run, or a divisor
// that would explode — each gets its own honest state. A revenue target is
// something a shop might price against; a plausible wrong one is worse than
// none. See lib/sales-goal.
// ============================================================================

import Link from 'next/link'
import { Target } from 'lucide-react'
import { computeGoal, goalProgress, type GoalInputs } from '@/lib/sales-goal'

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

export default function GoalBanner({
  inputs,
  received,
  scheduled,
  monthLabel,
  /** True when migration 101 hasn't run. */
  missing,
  /** True when migration 099 hasn't run, so `received` is not a real zero. */
  ledgerMissing,
  /** Only the owner can set this up — don't send a manager to a page they
   *  can't act on. (UI convention, not a database guarantee: `orgs_update_own`
   *  is org-scoped, not role-scoped, like every other setting on that page.) */
  canConfigure,
}: {
  inputs: GoalInputs
  received: number
  scheduled: number
  monthLabel: string
  missing?: boolean
  ledgerMissing?: boolean
  canConfigure?: boolean
}) {
  const goal = computeGoal(inputs)

  // ── This viewer can't see payroll ──
  if (goal.status === 'blind') {
    return (
      <section className="mb-4 bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 flex items-start gap-3">
        <Target className="w-4 h-4 text-[#9CA3AF] flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[#374151] font-medium">
            {ledgerMissing ? '—' : money(received)} received in {monthLabel}
          </div>
          <div className="text-[11.5px] text-[#9CA3AF] leading-snug mt-0.5">
            The monthly goal is built partly from payroll, which only the owner
            can see — so it isn&rsquo;t shown here rather than shown wrong. The
            owner can pin a fixed monthly figure in Settings to share it.
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
            Scheduled draws
          </div>
          <div className="text-[13px] font-mono tabular-nums text-[#374151]">
            {money(scheduled)}
          </div>
        </div>
      </section>
    )
  }

  // ── Not set up (or not migrated) ──
  if (missing || goal.status === 'unset' || goal.status === 'no_fixed') {
    return (
      <section className="mb-4 bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 flex items-start gap-3">
        <Target className="w-4 h-4 text-[#9CA3AF] flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[#374151] font-medium">
            {ledgerMissing ? '—' : money(received)} received in {monthLabel}
          </div>
          <div className="text-[11.5px] text-[#9CA3AF] leading-snug mt-0.5">
            {missing
              ? 'A monthly goal needs migration 101.'
              : goal.status === 'no_fixed'
                ? 'Set your overhead and team pay in Settings and this becomes a monthly target to aim at.'
                : 'Set a monthly goal and this becomes a target instead of a running total.'}
            {canConfigure && !missing && (
              <>
                {' '}
                <Link href="/settings" className="text-[#2563EB] hover:underline">
                  Set it up
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
            Scheduled draws
          </div>
          <div className="text-[13px] font-mono tabular-nums text-[#374151]">
            {money(scheduled)}
          </div>
        </div>
      </section>
    )
  }

  // ── A stored negative. Its own state because the "runs away to infinity"
  //    wording below is nonsense for one (it computes a MORE than 100%
  //    residual and then calls it too small).
  if (goal.status === 'negative') {
    return (
      <section className="mb-4 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3 flex items-start gap-3">
        <Target className="w-4 h-4 text-[#92400E] flex-shrink-0 mt-0.5" />
        <div className="text-[12.5px] text-[#92400E] leading-snug">
          The goal percentages are negative ({goal.materialPct}% material,{' '}
          {goal.profitPct}% profit), which can&rsquo;t be right. Set them again
          {canConfigure ? (
            <>
              {' '}
              in{' '}
              <Link href="/settings" className="underline">
                Settings
              </Link>
            </>
          ) : null}
          .
        </div>
      </section>
    )
  }

  // ── The percentages leave nothing to sell ──
  if (goal.status === 'impossible') {
    return (
      <section className="mb-4 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3 flex items-start gap-3">
        <Target className="w-4 h-4 text-[#92400E] flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[#92400E] font-medium">
            No goal can be computed.
          </div>
          <div className="text-[11.5px] text-[#92400E] leading-snug mt-0.5">
            Material ({goal.materialPct}%) and profit ({goal.profitPct}%) leave
            {' '}
            {Math.max(0, 100 - goal.materialPct - goal.profitPct)}% of each dollar
            to cover overhead, so the target runs away to infinity. Lower one of
            them
            {canConfigure ? (
              <>
                {' '}
                in{' '}
                <Link href="/settings" className="underline">
                  Settings
                </Link>
              </>
            ) : null}
            .
          </div>
        </div>
      </section>
    )
  }

  // ── The real thing ──
  const p = goalProgress(received, goal.amount)
  const barColor =
    p.tone === 'green' ? '#059669' : p.tone === 'amber' ? '#D97706' : '#DC2626'

  return (
    <section className="mb-4 bg-white border border-[#E5E7EB] rounded-xl px-4 py-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-4 flex-wrap">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
              Goal · {monthLabel}
            </span>
            <div className="text-[19px] font-semibold text-[#111] font-mono tabular-nums leading-tight">
              {money(goal.amount)}
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wider text-[#059669] font-semibold">
              Received
            </span>
            <div
              className="text-[19px] font-semibold font-mono tabular-nums leading-tight"
              style={{ color: barColor }}
            >
              {money(received)}
            </div>
          </div>
        </div>
        {/* ⛔ DEMOTED, NOT DELETED. The draw sum is still the plan for getting
            to the goal — it just isn't the definition of what's needed. */}
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
            Scheduled draws
          </div>
          <div className="text-[13px] font-mono tabular-nums text-[#374151]">
            {money(scheduled)}
          </div>
        </div>
      </div>

      <div className="mt-2.5 h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${p.width}%`, background: barColor }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-[#9CA3AF]">
        {/* ⛔ FLOOR, NOT ROUND. Rounding printed "100% of target · $320 to
            go" at 99.6% — a sentence that argues with itself. Floor can only
            ever understate, and "99%" beside "$320 to go" is coherent. */}
        <span>
          {p.pct >= 100
            ? `Goal met — ${Math.floor(p.pct)}% of target`
            : `${Math.floor(p.pct)}% of target · ${money(goal.amount - received)} to go`}
        </span>
        <span className="hidden sm:inline">
          {/* "material" here means material + consumables — everything bought
              for jobs. See the header of lib/sales-goal. */}
          {money(goal.monthlyFixed)}/mo fixed at {goal.materialPct}% material ·{' '}
          {goal.profitPct}% profit
        </span>
      </div>
    </section>
  )
}
