'use client'

// ============================================================================
// ShopRateBanner — the shop-rate gateway on an OPEN bid (lib/shop-rate-gateway)
// ============================================================================
// Shows only when this bid's pinned rate differs from the org's current one
// and that rate hasn't already been declined. Two explicit choices:
//   · Use $X/hr  — re-pins the job and recomputes its price.
//   · Keep $Y/hr — remembers the decline; nothing moves, and the banner stays
//                  quiet until the shop rate changes again.
// Sent estimate → the copy escalates to money: what was sent, what it would
// become, and that the PDF already sent stays as issued.
// ============================================================================

import { useEffect, useState } from 'react'
import {
  acceptShopRate,
  checkPriceAgrees,
  ignoreShopRate,
  priceAtRate,
  sentQuote,
  shopRateOffer,
  type RateOfferProject,
} from '@/lib/shop-rate-gateway'

type ProjectLike = RateOfferProject & {
  id: string
  bid_total?: number | null
  estimate_sent_at?: string | null
  estimate_number?: string | null
  estimate_snapshot_json?: unknown
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const rate = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}/hr`
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function ShopRateBanner({
  project,
  orgShopRate,
  currentTotal,
  onChanged,
}: {
  project: ProjectLike
  orgShopRate: number
  /** The price on screen right now (the page's live priceTotal). */
  currentTotal: number
  /** Reload the page after a choice. */
  onChanged: () => void | Promise<void>
}) {
  const offer = shopRateOffer(project, orgShopRate)
  const sent = sentQuote(project)
  const [newTotal, setNewTotal] = useState<number | null>(null)
  // null = still checking; the offer buttons wait for a yes.
  const [mathAgrees, setMathAgrees] = useState<boolean | null>(null)
  const [atPin, setAtPin] = useState<number | null>(null)
  const [busy, setBusy] = useState<'accept' | 'ignore' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!offer) return
    let cancelled = false
    setMathAgrees(null)
    Promise.all([priceAtRate(project.id, offer.to), checkPriceAgrees(project.id, currentTotal)]).then(([t, c]) => {
      if (cancelled) return
      setNewTotal(t)
      setMathAgrees(c.agrees)
      setAtPin(c.atPin)
    })
    return () => {
      cancelled = true
    }
    // Re-price only when the offer or the shown total changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, offer?.from, offer?.to, Math.round(currentTotal)])

  if (!offer) return null

  async function act(kind: 'accept' | 'ignore') {
    if (!offer) return
    setBusy(kind)
    setErr(null)
    try {
      if (kind === 'accept') await acceptShopRate(project.id, offer.to)
      else await ignoreShopRate(project.id, offer.to)
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      setBusy(null)
    }
  }

  // ⛔ THE GUARD. The math doesn't agree with the stored/shown price, so the
  // recompute is NOT offered — it would write the disagreement over the bid.
  if (mathAgrees === false) {
    return (
      <div className="mb-4 px-4 py-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-[12.5px] text-[#7F1D1D] leading-snug">
        <div className="text-[13px] font-semibold">
          Your shop rate is now {rate(offer.to)} — but this bid&apos;s stored price doesn&apos;t match its line math
        </div>
        <div className="mt-0.5">
          Stored {money(Number(project.bid_total) || 0)} · on screen {money(currentTotal)}
          {atPin != null ? ` · line math ${money(atPin)}` : ''}. The new rate isn&apos;t offered until these agree —
          open the subprojects below and check their totals, and flag it if they look wrong. Nothing has been changed.
        </div>
      </div>
    )
  }

  const label = sent?.number ? sent.number : 'the estimate'
  return (
    <div className="mb-4 px-4 py-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0 flex-1 text-[12.5px] text-[#1E3A8A] leading-snug">
        <div className="text-[13px] font-semibold">
          Your shop rate is now {rate(offer.to)} — this bid is priced at {rate(offer.from)}
        </div>
        {sent ? (
          <div className="mt-0.5">
            You sent {label}
            {sent.total != null ? ` at ${money(sent.total)}` : ''} on {day(sent.sentAt)}. Updating rates changes this
            quote to {newTotal != null ? money(newTotal) : '…'} — the PDF you sent stays as issued; re-send if you want
            the client to see the new number.
          </div>
        ) : (
          <div className="mt-0.5">
            Nothing changes unless you choose to. Using the new rate moves this bid from {money(currentTotal)} to{' '}
            {newTotal != null ? money(newTotal) : '…'}.
          </div>
        )}
        {err && <div className="mt-1 text-[#B91C1C]">{err}</div>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => act('ignore')}
          disabled={busy !== null}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-md border border-[#BFDBFE] bg-white text-[#1E3A8A] hover:bg-[#DBEAFE] disabled:opacity-50"
        >
          {busy === 'ignore' ? 'Saving…' : `Keep ${rate(offer.from)}`}
        </button>
        <button
          type="button"
          onClick={() => act('accept')}
          disabled={busy !== null || mathAgrees !== true}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {busy === 'accept' ? 'Updating…' : `Use ${rate(offer.to)}`}
        </button>
      </div>
    </div>
  )
}
