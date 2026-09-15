'use client'

// ============================================================================
// ProjectPaymentLedger — what's been paid on this job. Read-only.
// ============================================================================
// Andrew: "the payment milestone section of the project is worthless after the
// sale. That becomes locked and is referenced on the invoice, not the project
// page… that can instead be a link to the payments page, or show a timestamp
// of the payment we received and the amount."
//
// So post-sale this REPLACES the milestone builder. The draw schedule isn't
// shown here at all — it lives on /payments, which is the only place it
// changes. This is a record of cash, plus a way to get there.
//
// ⛔ NOTHING HERE WRITES. Not the schedule, not the ledger. Editing a payment
// means going to /payments. A read-only surface can't corrupt a contract, and
// this codebase has twice shipped a screen that silently rewrote money it was
// only supposed to display.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, CalendarClock } from 'lucide-react'
import {
  loadProjectDraws,
  loadProjectLedger,
  reconcileProject,
  type LedgerEntry,
  type PaymentRow,
} from '@/lib/payments'

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

/** ⛔ Parsed as LOCAL. `new Date('2026-09-01')` is UTC midnight, which is
 *  Aug 31 in any negative offset — the payment would show a day early. */
function dayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return iso || ''
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function ProjectPaymentLedger({
  projectId,
  contractTotal,
}: {
  projectId: string
  contractTotal: number
}) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  /** ⛔ THE SCHEDULE, SHOWN. Without this the project page had no view of its
   *  own draws at all post-sale, and `buildPaymentsView` hides a draw with
   *  nothing outstanding — so a fully-paid job showed only receipts and read
   *  as though its schedule had been deleted. */
  const [draws, setDraws] = useState<PaymentRow[]>([])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [res, rows] = await Promise.all([
        loadProjectLedger(projectId),
        loadProjectDraws(projectId),
      ])
      if (!alive) return
      setEntries(res.entries)
      setDraws(rows)
      setMissing(res.missing)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [projectId])

  const received = useMemo(() => entries.reduce((s, e) => s + e.amount, 0), [entries])
  // Same reconciliation the board runs, so the two can't tell different
  // stories about the same job.
  const recon = useMemo(
    () => reconcileProject(draws, entries, contractTotal),
    [draws, entries, contractTotal],
  )
  const remaining = Math.max(0, contractTotal - received)
  const credit = Math.max(0, received - contractTotal)
  const pct = contractTotal > 0 ? Math.min(100, (received / contractTotal) * 100) : 0

  return (
    <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
          Payments
        </div>
        {/* The schedule is editable on /payments and nowhere else. */}
        <Link
          href="/payments"
          className="inline-flex items-center gap-1 text-[11px] text-[#2563EB] hover:underline"
        >
          Payments board <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>

      {missing ? (
        <div className="px-3 py-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-xs text-[#92400E]">
          Payment tracking needs migration <code>099</code>.
        </div>
      ) : (
        <>
          {/* ⛔ THE AGREED TERMS, ALWAYS VISIBLE — INCLUDING WHEN PAID.
              The payments board deliberately drops a draw once it has nothing
              outstanding, so a finished job showed nothing but receipts and
              looked as if its schedule had been erased. This is the one place
              that answers "what did we agree to?" after the sale. Read-only:
              the schedule changes on /payments and nowhere else. */}
          {draws.length > 0 && (
            <div className="mb-3 rounded-lg border border-[#E5E7EB] overflow-hidden">
              <div className="px-2.5 py-1.5 bg-[#FAFAFA] border-b border-[#F3F4F6] flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                  Draw schedule
                </span>
                <span className="text-[10px] text-[#9CA3AF] font-mono tabular-nums">
                  {recon.draws.filter((d) => d.state === 'paid').length} of {recon.draws.length} paid
                </span>
              </div>
              {recon.draws.map((d) => (
                <div
                  key={d.row.id}
                  className="px-2.5 py-1.5 flex items-center gap-2 border-b border-[#F3F4F6] last:border-b-0"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      d.state === 'paid'
                        ? 'bg-[#059669]'
                        : d.state === 'partial'
                          ? 'bg-[#D97706]'
                          : 'bg-[#D1D5DB]'
                    }`}
                  />
                  <span className="text-[11.5px] text-[#374151] truncate flex-1 min-w-0">
                    {d.row.label}
                  </span>
                  {/* ⚠️ `scheduled`, not `stored`: a change order or a shrunk
                      contract rebalances the unpaid part, and showing the
                      stale authored figure would disagree with the board. */}
                  <span className="text-[11.5px] font-mono tabular-nums text-[#111] flex-shrink-0">
                    {money(d.scheduled)}
                  </span>
                  <span
                    className={`text-[10px] w-14 text-right flex-shrink-0 ${
                      d.state === 'paid' ? 'text-[#059669]' : 'text-[#9CA3AF]'
                    }`}
                  >
                    {d.state === 'paid'
                      ? 'paid'
                      : d.state === 'partial'
                        ? `${money(d.outstanding)} left`
                        : 'open'}
                  </span>
                </div>
              ))}
              {/* The stored rows not summing to the contract is how a phantom
                  dollar starts. Say it rather than letting the final draw
                  quietly absorb it. */}
              {Math.abs(recon.drift) >= 1 && (
                <div className="px-2.5 py-1.5 bg-[#FFFBEB] text-[10.5px] text-[#92400E] leading-snug">
                  The stored draws sum to {money(recon.drift > 0 ? contractTotal + recon.drift : contractTotal + recon.drift)},
                  {' '}{money(Math.abs(recon.drift))} {recon.drift > 0 ? 'over' : 'under'} the contract.
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mb-2">
            <Stat label="Contract" value={money(contractTotal)} />
            <Stat label="Received" value={money(received)} tone="green" />
            <Stat
              label={credit > 0 ? 'Overpaid' : 'Remaining'}
              value={money(credit > 0 ? credit : remaining)}
              tone={credit > 0 ? 'amber' : undefined}
            />
          </div>

          {contractTotal > 0 && (
            <div className="h-1.5 rounded-full bg-[#F3F4F6] overflow-hidden mb-3">
              <div
                className="h-full bg-[#059669] rounded-full transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {loading ? (
            <div className="text-[11.5px] text-[#9CA3AF] italic py-2">Loading payments…</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-3 bg-[#F9FAFB] border border-dashed border-[#E5E7EB] rounded-lg text-xs text-[#6B7280]">
              Nothing received yet.{' '}
              <Link href="/payments" className="text-[#2563EB] hover:underline">
                Log a payment
              </Link>{' '}
              when it comes in.
            </div>
          ) : (
            <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
              {entries.map((e, i) => (
                <div
                  key={e.id}
                  className={`flex items-center gap-2 px-3 py-2 ${
                    i > 0 ? 'border-t border-[#F3F4F6]' : ''
                  } ${e.amount < 0 ? 'bg-[#FEF2F2]' : ''}`}
                >
                  <CalendarClock className="w-3 h-3 text-[#9CA3AF] flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-[#111]">{dayLabel(e.paymentDate)}</div>
                    {(e.method || e.reference || e.notes) && (
                      <div className="text-[10.5px] text-[#9CA3AF] truncate">
                        {[e.method, e.reference, e.notes].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div
                    className={`text-[13px] font-semibold font-mono tabular-nums ${
                      e.amount < 0 ? 'text-[#B91C1C]' : 'text-[#059669]'
                    }`}
                  >
                    {money(e.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'green' | 'amber'
}) {
  const color =
    tone === 'green' ? 'text-[#059669]' : tone === 'amber' ? 'text-[#B45309]' : 'text-[#111]'
  return (
    <div className="px-2.5 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
      <div className="text-[9.5px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
        {label}
      </div>
      <div className={`text-[14px] font-semibold font-mono tabular-nums mt-0.5 ${color}`}>
        {value}
      </div>
    </div>
  )
}
