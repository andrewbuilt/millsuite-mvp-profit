'use client'

// ============================================================================
// MarginBanner — the default-margin gateway on an OPEN bid (migration 121)
// ============================================================================
// The twin of ShopRateBanner. A project inherits the org default margins it
// was created under (projects.locked_margins); saving new defaults in Settings
// moves nothing. When an open bid's lock differs from today's defaults in a
// bucket it hasn't pinned explicitly, this offers:
//   · Use new margins — re-locks the bid and recomputes its price.
//   · Keep            — remembers the decline; quiet until the defaults move
//                       again.
// Margins live on the PROJECT (052), so "use" reprices the whole bid, not just
// new scope — same as the rate. Same guards: the math-agrees check before any
// offer, and the sent-price wording once the estimate is out.
// ============================================================================

import { useEffect, useState } from 'react'
import {
  acceptMargins,
  checkPriceAgrees,
  ignoreMargins,
  marginOffer,
  orgMarginDefaults,
  priceAtMargins,
  sentQuote,
  shopRateOffer,
  type MarginOfferProject,
} from '@/lib/shop-rate-gateway'

type ProjectLike = MarginOfferProject & {
  id: string
  bid_total?: number | null
  estimate_sent_at?: string | null
  estimate_number?: string | null
  estimate_snapshot_json?: unknown
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const pct = (n: number) => `${Math.round(n * 10) / 10}%`
const LABEL = { labor: 'labor', material: 'material', consumable: 'consumables' } as const
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function MarginBanner({
  project,
  org,
  currentTotal,
  onChanged,
}: {
  project: ProjectLike
  org: Parameters<typeof orgMarginDefaults>[0]
  currentTotal: number
  onChanged: () => void | Promise<void>
}) {
  const offer = marginOffer(project, org)
  const sent = sentQuote(project)
  const [newTotal, setNewTotal] = useState<number | null>(null)
  const [mathAgrees, setMathAgrees] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<'accept' | 'ignore' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const key = offer ? JSON.stringify([offer.from, offer.to]) : ''

  useEffect(() => {
    if (!offer) return
    let cancelled = false
    setMathAgrees(null)
    Promise.all([priceAtMargins(project.id, offer.to), checkPriceAgrees(project.id, currentTotal)]).then(([t, c]) => {
      if (cancelled) return
      setNewTotal(t)
      setMathAgrees(c.agrees)
    })
    return () => {
      cancelled = true
    }
    // Re-price only when the offer or the shown total changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, key, Math.round(currentTotal)])

  if (!offer) return null
  // The math-agrees guard. When the rate banner is ALSO offering, it already
  // shows the red notice — don't say it twice; otherwise say it here.
  if (mathAgrees === false) {
    if (shopRateOffer(project, (org as { shop_rate?: number | null } | null)?.shop_rate)) return null
    return (
      <div className="mb-4 px-4 py-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-[12.5px] text-[#7F1D1D] leading-snug">
        <div className="text-[13px] font-semibold">
          Your default margins changed — but this bid&apos;s stored price doesn&apos;t match its line math
        </div>
        <div className="mt-0.5">
          Stored {money(Number(project.bid_total) || 0)} · on screen {money(currentTotal)}. The new margins aren&apos;t
          offered until these agree — check the subprojects below. Nothing has been changed.
        </div>
      </div>
    )
  }

  async function act(kind: 'accept' | 'ignore') {
    if (!offer) return
    setBusy(kind)
    setErr(null)
    try {
      if (kind === 'accept') await acceptMargins(project.id, offer.to)
      else await ignoreMargins(project.id, offer.to)
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      setBusy(null)
    }
  }

  const change = offer.buckets.map((b) => `${LABEL[b]} ${pct(offer.from[b])} → ${pct(offer.to[b])}`).join(' · ')
  return (
    <div className="mb-4 px-4 py-3 bg-[#F5F3FF] border border-[#DDD6FE] rounded-xl flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0 flex-1 text-[12.5px] text-[#3B0764] leading-snug">
        <div className="text-[13px] font-semibold">Your default margins changed since this bid was created</div>
        <div className="mt-0.5">{change}</div>
        {sent ? (
          <div className="mt-0.5">
            You sent {sent.number || 'the estimate'}
            {sent.total != null ? ` at ${money(sent.total)}` : ''} on {day(sent.sentAt)}. Using the new margins changes
            this quote to {newTotal != null ? money(newTotal) : '…'} — the PDF you sent stays as issued; re-send if you
            want the client to see the new number.
          </div>
        ) : (
          <div className="mt-0.5">
            Nothing changes unless you choose to. The new margins move this bid from {money(currentTotal)} to{' '}
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
          className="px-3 py-1.5 text-[12px] font-semibold rounded-md border border-[#DDD6FE] bg-white text-[#3B0764] hover:bg-[#EDE9FE] disabled:opacity-50"
        >
          {busy === 'ignore' ? 'Saving…' : 'Keep this bid’s margins'}
        </button>
        <button
          type="button"
          onClick={() => act('accept')}
          disabled={busy !== null || mathAgrees !== true}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-50"
        >
          {busy === 'accept' ? 'Updating…' : 'Use new margins'}
        </button>
      </div>
    </div>
  )
}
