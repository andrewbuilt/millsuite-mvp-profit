'use client'

// ============================================================================
// ReceivablesCard — invoiced AR, aged, reconciled against the cash ledger.
// ============================================================================
// Moved off /dashboard 2026-09-12 (home consolidation, Andrew's pick). The
// MATH was rebuilt on the way: the old inline version read `amount_received`
// alone, which on a QuickBooks org is permanently 0 — see the header of
// lib/receivables for all three bugs and why each one mattered.
//
// ⛔ THIS IS NOT THE SAME NUMBER AS "MONEY IN" ABOVE IT, AND THAT'S THE POINT.
// Money in = the DRAW SCHEDULE (what the shop plans to collect this month).
// This card = INVOICES ACTUALLY SENT (what a client has been asked to pay).
// A draw with no invoice appears in one and not the other, legitimately. They
// are labelled so nobody has to guess which is which — if they ever need to
// agree, the schedule is the thing to change, not this.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { buildReceivables, localToday, type ArInvoice } from '@/lib/receivables'
import { loadOrgLedger } from '@/lib/payments'

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

export default function ReceivablesCard({ orgId }: { orgId: string | undefined }) {
  const [invoices, setInvoices] = useState<ArInvoice[]>([])
  const [ledger, setLedger] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // True when migration 099 isn't there. The card then falls back to the
  // invoice column alone and SAYS so, rather than printing a QB org's
  // gross-of-payments total as if it were the balance.
  const [ledgerMissing, setLedgerMissing] = useState(false)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [invRes, led] = await Promise.all([
        supabase
          .from('client_invoices')
          // ⛔ project_id is load-bearing: it's what ties an invoice to the
          // cash ledger. The old query omitted it, which is part of why the
          // reconciliation didn't exist.
          .select('id, project_id, status, due_date, total, amount_received')
          .eq('org_id', orgId)
          // ⛔ `paid` IS IN HERE ON PURPOSE, AND IT IS NOT DISPLAYED. The
          // ledger is project-level cash covering every obligation on that
          // project; a settled invoice has to be present to absorb its own
          // share, or that cash spills onto the open ones and wipes out money
          // the shop is genuinely owed. `open` below decides what renders.
          // Draft is excluded (nobody's been asked to pay yet) and so is void.
          .in('status', ['sent', 'partial', 'overdue', 'paid']),
        loadOrgLedger(orgId),
      ])
      if (cancelled) return

      if (invRes.error) {
        setError('Could not load invoices.')
        setLoading(false)
        return
      }

      setInvoices(
        (invRes.data || []).map((r: Record<string, unknown>) => ({
          id: String(r.id),
          projectId: r.project_id ? String(r.project_id) : null,
          dueDate: r.due_date ? String(r.due_date) : null,
          total: Number(r.total) || 0,
          amountReceived: Number(r.amount_received) || 0,
          open: String(r.status) !== 'paid',
        })),
      )

      const net = new Map<string, number>()
      for (const e of led.entries) {
        net.set(e.projectId, (net.get(e.projectId) ?? 0) + e.amount)
      }
      setLedger(net)
      setLedgerMissing(led.missing)
      setError(led.error)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const todayIso = localToday()
  const aging = useMemo(
    () => buildReceivables(invoices, ledger, todayIso),
    [invoices, ledger, todayIso],
  )

  const hasAny =
    aging.overdue.count + aging.due7.count + aging.due30.count > 0 ||
    aging.hasUnbucketed

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-[#F3F4F6] flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
            Invoiced
          </span>
          <span className="block text-[10.5px] text-[#D1D5DB] leading-tight">
            what clients have been billed
          </span>
        </div>
        <Link href="/invoices" className="text-[11px] text-[#2563EB] hover:underline whitespace-nowrap">
          View all →
        </Link>
      </div>

      {error && (
        <div className="mx-4 mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="px-4 sm:px-5 py-4 text-[12.5px] text-[#9CA3AF] italic">
          Loading invoices…
        </div>
      ) : !hasAny ? (
        <div className="px-4 sm:px-5 py-4 text-[12.5px] text-[#9CA3AF] italic">
          Nothing outstanding.
        </div>
      ) : (
        <>
          {/* ⛔ ALL THREE GO TO THE SAME PLACE, PLAINLY. /invoices reads no
              query params at all — it calls neither useSearchParams nor
              searchParams, and `due_before` appears nowhere else in the
              codebase. The old card passed filters that did nothing, which
              reads as a filtered view and isn't one. Give it real filtering
              and these can point at it. */}
          <Row label="Overdue" bucket={aging.overdue} tone="red" href="/invoices" />
          <Row label="Due in 7 days" bucket={aging.due7} tone="amber" href="/invoices" />
          <Row label="Due in 8–30 days" bucket={aging.due30} tone="gray" href="/invoices" last={!aging.hasUnbucketed} />
          {/* ⛔ The old card dropped both of these on the floor. An invoice
              with no due date, or one due in two months, is still money
              owed — saying so is the difference between a total and a
              plausible-looking total. */}
          {aging.hasUnbucketed && (
            <div className="px-4 sm:px-5 py-2.5 text-[11px] text-[#9CA3AF] leading-snug">
              {aging.later.count > 0 && (
                <div>
                  {money(aging.later.total)} due later than 30 days
                  {aging.noDueDate.count > 0 ? ' · ' : ''}
                </div>
              )}
              {aging.noDueDate.count > 0 && (
                <div className="text-[#92400E]">
                  {money(aging.noDueDate.total)} with no due date — set one on{' '}
                  <Link href="/invoices" className="underline">
                    Invoices
                  </Link>
                </div>
              )}
            </div>
          )}
          {ledgerMissing && (
            <div className="px-4 sm:px-5 pb-2.5 text-[10.5px] text-[#92400E] leading-snug">
              Payments table not set up — these totals ignore cash received.
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Row({
  label,
  bucket,
  tone,
  href,
  last,
}: {
  label: string
  bucket: { count: number; total: number }
  tone: 'red' | 'amber' | 'gray'
  href: string
  last?: boolean
}) {
  const dim = bucket.count === 0
  const valueClass = dim
    ? 'text-[#9CA3AF]'
    : tone === 'red'
      ? 'text-[#991B1B]'
      : tone === 'amber'
        ? 'text-[#92400E]'
        : 'text-[#374151]'
  const dotClass =
    tone === 'red' ? 'bg-[#DC2626]' : tone === 'amber' ? 'bg-[#F59E0B]' : 'bg-[#9CA3AF]'
  const Wrap: any = dim ? 'div' : Link
  const wrapProps = dim ? {} : { href }
  return (
    <Wrap
      {...wrapProps}
      className={`flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 ${
        last ? '' : 'border-b border-[#F3F4F6]'
      } ${dim ? '' : 'hover:bg-[#F9FAFB] transition-colors'}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-[12.5px] text-[#374151] truncate">{label}</span>
        <span className="text-[11.5px] text-[#9CA3AF] font-mono tabular-nums">
          {bucket.count} {bucket.count === 1 ? 'invoice' : 'invoices'}
        </span>
      </div>
      <span className={`text-[13px] font-mono tabular-nums font-medium ${valueClass}`}>
        {money(bucket.total)}
      </span>
    </Wrap>
  )
}
