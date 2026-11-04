'use client'

// ============================================================================
// /payments — the cash-flow monitor (Payments v4, 2026-11-05)
// ============================================================================
// QuickBooks is the accounting truth. This page notes payments after they
// happen in QB (the LEDGER, green) beside a loose FORECAST of what's left and
// roughly when (white). The two lists are independent — see
// lib/payment-forecast for the constitution and components/payments/
// PaymentsBoard for the board itself.
//
// This file is the wiring: auth, the payments allowlist (115), loading, the
// goal banner, and the real database api the board writes through.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import PlanGate from '@/components/plan-gate'
import GoalBanner from '@/components/payments/GoalBanner'
import PaymentsBoard, { type PaymentsBoardApi, type PaymentsBoardData } from '@/components/payments/PaymentsBoard'
import { useAuth } from '@/lib/auth-context'
import { usePaymentsVisibility } from '@/lib/payments-visibility'
import { deriveMonthlyFixed } from '@/lib/sales-goal'
import { loadGoalSettings, type GoalSettings } from '@/lib/sales-goal-data'
import { loadShopRateSetup, sumOverheadAnnual, sumTeamAnnualComp } from '@/lib/shop-rate-setup'
import {
  buildForecastView,
  currentMonth,
  deletePayment,
  loadOrgLedger,
  loadOrgPayments,
  loadSoldProjects,
  logPayment,
  monthLabel,
  reschedulePayment,
  saveForecast,
  updatePayment,
} from '@/lib/payments'

export default function PaymentsPage() {
  const { org, user } = useAuth()
  // Who sees money movement (115). RLS already blanks the data for the
  // unlisted; this gate replaces a board of zero rows with a sentence.
  const payVis = usePaymentsVisibility()
  const [data, setData] = useState<PaymentsBoardData>({ rows: [], ledger: [], contractTotals: {}, soldProjects: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ledgerMissing, setLedgerMissing] = useState(false)
  const [today] = useState(() => currentMonth())
  // Deep links from the project page, read once.
  const [deep] = useState(() => {
    if (typeof window === 'undefined') return { edit: null, redivide: null }
    const q = new URLSearchParams(window.location.search)
    return { edit: q.get('edit'), redivide: q.get('redivide') }
  })
  useEffect(() => {
    // Drop the params so a refresh doesn't reopen the modal forever.
    if (deep.edit || deep.redivide) window.history.replaceState({}, '', '/payments')
  }, [deep])

  const refresh = useCallback(async () => {
    if (!org?.id) return
    const [sched, led, sold] = await Promise.all([
      loadOrgPayments(org.id),
      loadOrgLedger(org.id),
      loadSoldProjects(org.id),
    ])
    setLoadError(sched.error || led.error)
    setLedgerMissing(led.missing)
    // ⛔ Don't blank the board on a failed refresh — a failed drag would
    // otherwise wipe every card. An empty board must only mean an empty board.
    setData((prev) => ({
      rows: sched.error ? prev.rows : sched.rows,
      contractTotals: sched.error ? prev.contractTotals : sched.contractTotals,
      ledger: led.error ? prev.ledger : led.entries,
      soldProjects: sold,
    }))
    setLoading(false)
  }, [org?.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const api = useMemo<PaymentsBoardApi>(
    () => ({
      reschedule: (rowId, expectedDate) => reschedulePayment(rowId, expectedDate, org?.id),
      logPayment: async (input) => {
        if (!org?.id) throw new Error('No shop loaded.')
        await logPayment({ ...input, orgId: org.id, createdBy: user?.id ?? null })
      },
      updatePayment: async (id, input) => {
        await updatePayment(id, input, org?.id)
      },
      deletePayment: (id) => deletePayment(id, org?.id),
      saveForecast: async (projectId, rows, via, contractTotal) => {
        if (!org?.id) throw new Error('No shop loaded.')
        await saveForecast(org.id, projectId, rows, via, contractTotal)
      },
    }),
    [org?.id, user?.id],
  )

  /** THIS month, regardless of where the pager is — the goal never pages. */
  const thisMonth = useMemo(
    () => buildForecastView(data.rows, data.ledger, [today], today).months[0],
    [data.rows, data.ledger, today],
  )

  /** Goal settings + the derived fixed cost behind them (migration 101). */
  const [goalSettings, setGoalSettings] = useState<GoalSettings | null>(null)
  const [derivedFixed, setDerivedFixed] = useState(0)
  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      // ⛔ loadShopRateSetup THROWS (.single()) — settled separately.
      const settings = await loadGoalSettings(org.id).catch(() => null)
      const setup = await loadShopRateSetup(org.id).catch(() => null)
      if (cancelled) return
      setGoalSettings(settings)
      setDerivedFixed(
        setup ? deriveMonthlyFixed(sumOverheadAnnual(setup.overhead), sumTeamAnnualComp(setup.team)) : 0,
      )
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  if (!payVis.loading && !payVis.canSee) {
    return (
      <PlanGate requires="invoices">
        <div className="min-h-screen flex items-center justify-center px-6 text-center">
          <p className="text-sm text-[#6B7280] max-w-sm">
            Payments aren&rsquo;t part of your view. Ask the shop owner to add you on Settings → Who can see
            payments.
          </p>
        </div>
      </PlanGate>
    )
  }

  return (
    <PlanGate requires="invoices">
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="p-6 max-w-[1200px] mx-auto">
          {loadError && (
            <div className="mb-4 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
              Couldn&rsquo;t load payments: {loadError}
            </div>
          )}
          {loading ? (
            <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading payments…</div>
          ) : (
            <PaymentsBoard
              data={data}
              api={api}
              today={today}
              onChanged={refresh}
              ledgerMissing={ledgerMissing}
              initialEditProjectId={deep.edit}
              initialRedivideProjectId={deep.redivide}
              banner={
                thisMonth && goalSettings ? (
                  <GoalBanner
                    inputs={{
                      monthlyFixed: goalSettings.fixedMonthlyOverride ?? derivedFixed,
                      materialPct: goalSettings.materialPct,
                      profitPct: goalSettings.profitPct,
                      consumableMarkupPct: org?.consumable_markup_pct ?? 0,
                      // Payroll is owner-only in the database, so an admin's
                      // derived fixed cost is overhead alone.
                      fixedIsKnown: goalSettings.fixedMonthlyOverride != null || user?.role === 'owner',
                    }}
                    received={thisMonth.receivedTotal}
                    scheduled={thisMonth.scheduled}
                    monthLabel={monthLabel(today)}
                    missing={goalSettings.missing}
                    ledgerMissing={ledgerMissing}
                    canConfigure={user?.role === 'owner'}
                  />
                ) : null
              }
            />
          )}
        </div>
      </div>
    </PlanGate>
  )
}
