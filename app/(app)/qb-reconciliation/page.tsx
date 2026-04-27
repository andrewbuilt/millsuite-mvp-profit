'use client'

// ============================================================================
// /qb-reconciliation — Phase 9 review surface for QuickBooks payment events
// ============================================================================
// MillSuite watches QB; this page is where the bookkeeper resolves anything
// the match pipeline couldn't (or shouldn't) auto-apply. The layout mirrors
// the rollup/projects list idiom:
//
//   • Filter tabs (Needs review / Confirmed / Dismissed / All)
//   • A row per qb_events record
//   • Each "needs review" row shows the suggested match, confidence, reasons,
//     and primary actions: Confirm · Dismiss · Pick different project
//   • A simulator at the bottom to inject events while the real Intuit
//     webhook is still stubbed. See lib/qb-events.ts for the real pipeline.
//
// Anything the user confirms from this page flips the underlying
// cash_flow_receivables row to status='received', which is what milestone
// widgets on /rollup + /handoff already read — so the round trip lands
// without additional wiring.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import {
  listQbEvents,
  findCandidates,
  findInvoiceCandidates,
  confirmMatch,
  confirmInvoiceMatch,
  dismissEvent,
  processIncoming,
  type QbEvent,
  type QbMatchStatus,
  type MatchCandidate,
  type InvoiceMatchCandidate,
  AUTO_MATCH_THRESHOLD,
} from '@/lib/qb-events'
import { AlertCircle, CheckCircle2, Circle, XCircle, RefreshCw, Zap } from 'lucide-react'

type FilterTab = 'review' | 'confirmed' | 'dismissed' | 'all'

const TAB_LABELS: Record<FilterTab, string> = {
  review: 'Needs review',
  confirmed: 'Confirmed',
  dismissed: 'Dismissed',
  all: 'All',
}

function money(n: number): string {
  if (!n && n !== 0) return '$0'
  return n < 0 ? `-$${Math.abs(Math.round(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`
}

function confidencePct(c: number | null | undefined): string {
  if (c == null) return '—'
  return `${Math.round(c * 100)}%`
}

function confidenceTone(c: number | null | undefined): string {
  if (c == null) return 'text-[#9CA3AF]'
  if (c >= AUTO_MATCH_THRESHOLD) return 'text-[#059669]'
  if (c >= 0.6) return 'text-[#2563EB]'
  if (c >= 0.4) return 'text-[#D97706]'
  return 'text-[#DC2626]'
}

/** Pull the invoice id out of an event's match_reasons. processIncoming
 *  encodes a parked invoice match as `invoice:${id}` in the first
 *  reason slot — see lib/qb-events.processIncoming. */
function parkedInvoiceId(evt: QbEvent): string | null {
  const tag = evt.match_reasons?.find((r) => r.startsWith('invoice:'))
  return tag ? tag.slice('invoice:'.length) : null
}

export default function QbReconciliationPage() {
  const { org, user } = useAuth()
  const [events, setEvents] = useState<QbEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<FilterTab>('review')
  // Per-event expanded-candidate view.
  const [expanded, setExpanded] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Record<string, MatchCandidate[]>>({})
  const [invoiceCandidates, setInvoiceCandidates] = useState<
    Record<string, InvoiceMatchCandidate[]>
  >({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [connection, setConnection] = useState<{ realm_id: string; connected_at: string } | null>(null)

  const refresh = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    const [rows, connRes] = await Promise.all([
      listQbEvents(org.id, { status: 'all' }),
      supabase
        .from('qb_connections')
        .select('realm_id, connected_at')
        .eq('org_id', org.id)
        .maybeSingle(),
    ])
    setEvents(rows)
    setConnection(connRes.data || null)
    setLoading(false)
  }, [org?.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Load candidates lazily the first time a row is expanded — keeps the
  // initial page paint cheap when there are many unmatched events.
  async function loadCandidatesFor(evt: QbEvent) {
    if (!org?.id) return
    if (candidates[evt.id] && invoiceCandidates[evt.id]) return
    const probe = {
      customer_name: evt.customer_name,
      amount: evt.amount,
      occurred_at: evt.occurred_at,
    }
    const [cands, invs] = await Promise.all([
      findCandidates(org.id, probe),
      findInvoiceCandidates(org.id, probe),
    ])
    setCandidates((c) => ({ ...c, [evt.id]: cands }))
    setInvoiceCandidates((c) => ({ ...c, [evt.id]: invs }))
  }

  async function handleConfirm(evt: QbEvent, receivableId: string) {
    setBusyId(evt.id)
    const ok = await confirmMatch(evt.id, receivableId, { reviewerId: user?.id })
    setBusyId(null)
    if (!ok) {
      alert('Failed to confirm match — check console for details.')
      return
    }
    refresh()
  }

  async function handleConfirmInvoice(evt: QbEvent, invoiceId: string) {
    setBusyId(evt.id)
    const ok = await confirmInvoiceMatch(evt.id, invoiceId, { reviewerId: user?.id })
    setBusyId(null)
    if (!ok) {
      alert('Failed to confirm invoice match — check console for details.')
      return
    }
    refresh()
  }

  async function handleDismiss(evt: QbEvent) {
    setBusyId(evt.id)
    const ok = await dismissEvent(evt.id, user?.id || null)
    setBusyId(null)
    if (!ok) {
      alert('Failed to dismiss event.')
      return
    }
    refresh()
  }

  // Simulator: inserts a synthetic event + runs the match pipeline.
  const [simCustomer, setSimCustomer] = useState('')
  const [simAmount, setSimAmount] = useState('')
  const [simMemo, setSimMemo] = useState('')
  const [simType, setSimType] = useState<QbEvent['event_type']>('payment_received')
  const [simBusy, setSimBusy] = useState(false)

  async function handleSimulate() {
    if (!org?.id) return
    const amt = parseFloat(simAmount)
    if (!Number.isFinite(amt) || amt <= 0) {
      alert('Enter a valid payment amount.')
      return
    }
    setSimBusy(true)
    try {
      await processIncoming({
        org_id: org.id,
        source: 'manual',
        event_type: simType,
        occurred_at: new Date().toISOString(),
        customer_name: simCustomer.trim() || null,
        amount: amt,
        memo: simMemo.trim() || null,
        payload: { simulated: true, generated_at: new Date().toISOString() },
      })
    } catch (e) {
      console.error('simulate', e)
      alert('Simulator failed — check console.')
    }
    setSimCustomer('')
    setSimAmount('')
    setSimMemo('')
    setSimBusy(false)
    refresh()
  }

  const filtered = useMemo(() => {
    if (tab === 'all') return events
    if (tab === 'review') {
      return events.filter((e) => e.match_status === 'unmatched' || e.match_status === 'matched')
    }
    return events.filter((e) => e.match_status === tab)
  }, [events, tab])

  const counts = useMemo(() => {
    const acc: Record<FilterTab, number> = { review: 0, confirmed: 0, dismissed: 0, all: events.length }
    for (const e of events) {
      if (e.match_status === 'unmatched' || e.match_status === 'matched') acc.review++
      else if (e.match_status === 'confirmed') acc.confirmed++
      else if (e.match_status === 'dismissed') acc.dismissed++
    }
    return acc
  }, [events])

  return (
    <>
      <Nav />
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#111] tracking-tight">QuickBooks reconciliation</h1>
            <p className="text-sm text-[#6B7280] mt-1 max-w-xl">
              Every deposit, invoice payment, and refund we observe from QuickBooks lands here.
              Confirm or reassign suggested matches to flip their matching milestone to{' '}
              <span className="font-mono text-[#059669]">received</span>.
            </p>
          </div>
          <div className="text-right">
            {connection ? (
              <div className="text-xs text-[#6B7280]">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D] font-semibold uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#15803D]" />
                  Connected
                </span>
                <div className="mt-1 font-mono text-[11px] text-[#9CA3AF]">
                  realm {connection.realm_id}
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#D97706]">
                Not connected.{' '}
                <Link href="/settings" className="underline">Connect in Settings →</Link>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-[#E5E7EB] mb-5">
          {(['review', 'confirmed', 'dismissed', 'all'] as FilterTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-[#2563EB] text-[#111]'
                  : 'border-transparent text-[#6B7280] hover:text-[#111]'
              }`}
            >
              {TAB_LABELS[t]}
              <span className="ml-1.5 text-[11px] text-[#9CA3AF]">{counts[t]}</span>
            </button>
          ))}
          <button
            onClick={refresh}
            className="ml-auto px-3 py-1.5 text-xs text-[#6B7280] hover:text-[#111] inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {/* Events list */}
        {loading ? (
          <div className="text-sm text-[#9CA3AF]">Loading events…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-[#E5E7EB] rounded-xl">
            <Circle className="w-8 h-8 text-[#D1D5DB] mx-auto mb-2" />
            <div className="text-sm text-[#6B7280]">
              {tab === 'review'
                ? 'Nothing to review — everything QB has sent is resolved.'
                : tab === 'confirmed'
                ? 'No confirmed events yet.'
                : tab === 'dismissed'
                ? 'No dismissed events.'
                : 'No QuickBooks events observed yet.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((evt) => {
              const cands = candidates[evt.id] || []
              const isExpanded = expanded === evt.id
              const isBusy = busyId === evt.id
              const matchedBadge = STATUS_BADGE[evt.match_status]
              return (
                <div
                  key={evt.id}
                  className="bg-white border border-[#E5E7EB] rounded-xl p-4"
                >
                  <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-[15px] font-semibold text-[#111]">
                          {evt.customer_name || <span className="text-[#9CA3AF] italic">No customer name</span>}
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${matchedBadge.cls}`}>
                          {matchedBadge.label}
                        </span>
                        {evt.source === 'manual' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] font-semibold uppercase tracking-wider">
                            simulated
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#6B7280]">
                        <span className="font-mono text-[#111]">{money(evt.amount)}</span>
                        <span className="mx-1.5 text-[#D1D5DB]">·</span>
                        {new Date(evt.occurred_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        <span className="mx-1.5 text-[#D1D5DB]">·</span>
                        {evt.event_type.replace(/_/g, ' ')}
                        {evt.memo && (
                          <>
                            <span className="mx-1.5 text-[#D1D5DB]">·</span>
                            <span className="italic">{evt.memo}</span>
                          </>
                        )}
                      </div>
                      {evt.match_status === 'matched' &&
                        (evt.matched_receivable_id || parkedInvoiceId(evt)) && (
                          <div className="mt-2 text-xs">
                            <span className="text-[#6B7280]">
                              Suggested {parkedInvoiceId(evt) ? 'invoice' : 'milestone'}:{' '}
                            </span>
                            <span className={`font-semibold ${confidenceTone(evt.match_confidence)}`}>
                              {confidencePct(evt.match_confidence)} confidence
                            </span>
                            {evt.match_reasons?.length > 0 && (
                              <ul className="mt-1 ml-1 text-[11px] text-[#9CA3AF] list-disc list-inside">
                                {evt.match_reasons
                                  .filter((r) => !r.startsWith('invoice:'))
                                  .map((r, i) => (
                                    <li key={i}>{r}</li>
                                  ))}
                              </ul>
                            )}
                          </div>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {evt.match_status !== 'confirmed' && evt.match_status !== 'dismissed' && (
                        <>
                          {(evt.matched_receivable_id || parkedInvoiceId(evt)) && (
                            <button
                              onClick={() => {
                                const invId = parkedInvoiceId(evt)
                                if (invId) handleConfirmInvoice(evt, invId)
                                else if (evt.matched_receivable_id)
                                  handleConfirm(evt, evt.matched_receivable_id)
                              }}
                              disabled={isBusy}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#059669] text-white hover:bg-[#047857] disabled:opacity-50 inline-flex items-center gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Confirm suggested
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              const next = isExpanded ? null : evt.id
                              setExpanded(next)
                              if (next) await loadCandidatesFor(evt)
                            }}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]"
                          >
                            {isExpanded ? 'Hide candidates' : 'Pick different project'}
                          </button>
                          <button
                            onClick={() => handleDismiss(evt)}
                            disabled={isBusy}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEE2E2] disabled:opacity-50 inline-flex items-center gap-1.5"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Dismiss
                          </button>
                        </>
                      )}
                      {evt.match_status === 'confirmed' && (
                        <div className="text-xs text-[#059669] font-semibold inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Confirmed
                          {evt.reviewed_at && (
                            <span className="text-[10px] text-[#9CA3AF] font-normal ml-1">
                              {new Date(evt.reviewed_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      )}
                      {evt.match_status === 'dismissed' && (
                        <div className="text-xs text-[#6B7280] inline-flex items-center gap-1.5">
                          <XCircle className="w-3.5 h-3.5" />
                          Dismissed
                        </div>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-[#F3F4F6] space-y-1.5">
                      {(invoiceCandidates[evt.id] || []).length > 0 && (
                        <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-0.5">
                          Open invoices
                        </div>
                      )}
                      {(invoiceCandidates[evt.id] || []).map((inv) => (
                        <div
                          key={inv.invoiceId}
                          className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center py-2 px-3 rounded-lg bg-[#F9FAFB] hover:bg-[#F3F4F6] text-xs"
                        >
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-[#111] truncate">
                              {inv.projectName}{' '}
                              <span className="font-mono text-[#6B7280] font-normal">
                                · {inv.invoiceNumber}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#6B7280] truncate">
                              {inv.clientName || '—'} · balance {money(inv.balanceDue)} of {money(inv.total)}
                              {' · due '}{inv.dueDate}
                            </div>
                          </div>
                          <div className="font-mono text-[#111]">{money(inv.balanceDue)}</div>
                          <div className={`font-semibold ${confidenceTone(inv.confidence)}`}>
                            {confidencePct(inv.confidence)}
                          </div>
                          <button
                            onClick={() => handleConfirmInvoice(evt, inv.invoiceId)}
                            disabled={isBusy}
                            className="px-3 py-1 text-xs font-semibold rounded bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                          >
                            Confirm
                          </button>
                        </div>
                      ))}
                      {cands.length > 0 && (invoiceCandidates[evt.id] || []).length > 0 && (
                        <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mt-2 mb-0.5">
                          Projected milestones
                        </div>
                      )}
                      {cands.length === 0 && (invoiceCandidates[evt.id] || []).length === 0 ? (
                        <div className="text-xs text-[#9CA3AF] italic inline-flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5" />
                          No plausible candidates — neither open invoices nor projected milestones scored above the suggest threshold. Confirm manually from the project page or dismiss this event.
                        </div>
                      ) : (
                        cands.map((c) => (
                          <div
                            key={c.receivableId}
                            className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center py-2 px-3 rounded-lg bg-[#F9FAFB] hover:bg-[#F3F4F6] text-xs"
                          >
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-[#111] truncate">
                                {c.projectName}
                              </div>
                              <div className="text-[11px] text-[#6B7280] truncate">
                                {c.clientName || '—'} · {c.milestoneLabel}
                                {c.expectedDate && ` · expected ${c.expectedDate}`}
                              </div>
                            </div>
                            <div className="font-mono text-[#111]">{money(c.amount)}</div>
                            <div className={`font-semibold ${confidenceTone(c.confidence)}`}>
                              {confidencePct(c.confidence)}
                            </div>
                            <button
                              onClick={() => handleConfirm(evt, c.receivableId)}
                              disabled={isBusy}
                              className="px-3 py-1 text-xs font-semibold rounded bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
                            >
                              Confirm
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Simulator — lets us exercise the pipeline without a live Intuit connection. */}
        <div className="mt-10 bg-white border border-dashed border-[#E5E7EB] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-[#D97706]" />
            <h2 className="text-sm font-semibold text-[#111]">Simulate a QuickBooks event</h2>
          </div>
          <p className="text-xs text-[#6B7280] mb-4">
            While real Intuit webhooks are stubbed, use this form to exercise the match
            pipeline end-to-end. Inserts a <span className="font-mono">source='manual'</span>{' '}
            row into <span className="font-mono">qb_events</span> and runs matching.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr_1fr_0.8fr_auto] gap-2 items-start">
            <input
              type="text"
              value={simCustomer}
              onChange={(e) => setSimCustomer(e.target.value)}
              placeholder="Customer name"
              className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            <input
              type="number"
              step="0.01"
              value={simAmount}
              onChange={(e) => setSimAmount(e.target.value)}
              placeholder="Amount"
              className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] font-mono"
            />
            <input
              type="text"
              value={simMemo}
              onChange={(e) => setSimMemo(e.target.value)}
              placeholder="Memo (optional)"
              className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            <select
              value={simType}
              onChange={(e) => setSimType(e.target.value as QbEvent['event_type'])}
              className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            >
              <option value="payment_received">Payment received</option>
              <option value="invoice_paid">Invoice paid</option>
              <option value="deposit_received">Deposit received</option>
              <option value="other">Other</option>
            </select>
            <button
              onClick={handleSimulate}
              disabled={simBusy}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {simBusy ? 'Sending…' : 'Simulate'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

const STATUS_BADGE: Record<QbMatchStatus, { label: string; cls: string }> = {
  unmatched: { label: 'Unmatched', cls: 'bg-[#FEE2E2] text-[#B91C1C]' },
  matched: { label: 'Suggested', cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  confirmed: { label: 'Confirmed', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  dismissed: { label: 'Dismissed', cls: 'bg-[#F3F4F6] text-[#6B7280]' },
}
