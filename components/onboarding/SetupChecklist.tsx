'use client'

// ============================================================================
// SetupChecklist — "Getting set up", on the dashboard, owner only
// ============================================================================
// Picks up where the 2-step wizard puts you down. The wizard covers the two
// things you can't use the app without (shop rate, base cabinet); this covers
// the four that make the app yours, and it checks itself off from real data
// rather than from a "I clicked it" flag — so it's honest about what's actually
// configured, and it's resumable by construction.
//
// One exception, and it's a genuine modelling gap rather than a shortcut:
// INVOICING MODE has no observable done-state. `invoicing_mode` defaults to
// 'internal', which is also a legitimate choice, so the stored value cannot
// tell "decided to bill in-house" from "never looked". That item is therefore
// an explicit acknowledgement, recorded per-user in walkthrough_state.
//
// Disappears on its own once all four are done — a checklist with nothing left
// on it is clutter, not reassurance.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Sparkles, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { loadMyProgress, saveTourProgress, type TourProgress } from '@/lib/me-progress'
import { SETUP_CHECKLIST_KEY } from '@/lib/walkthroughs'

interface Item {
  key: string
  done: boolean
  label: string
  hint: string
  cta: string
  href?: string
  onAck?: () => void
}

export default function SetupChecklist() {
  const { user, org } = useAuth()
  const [progress, setProgress] = useState<TourProgress | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [teamCount, setTeamCount] = useState<number | null>(null)

  const isOwner = user?.role === 'owner'

  useEffect(() => {
    if (!user?.id || !isOwner) return
    let cancelled = false
    void loadMyProgress(user.id).then((p) => {
      if (cancelled) return
      setProgress(p.walkthrough_state[SETUP_CHECKLIST_KEY] ?? {})
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id, isOwner])

  // team_members isn't in the auth context's org select, so it needs its own
  // read. Best-effort: a failure shows the item as not-done, which is the safe
  // way to be wrong — it nudges rather than falsely reassures.
  useEffect(() => {
    if (!org?.id || !isOwner) return
    let cancelled = false
    void supabase
      .from('orgs')
      .select('team_members')
      .eq('id', org.id)
      .single()
      .then(({ data }) => {
        if (cancelled) return
        const roster = (data?.team_members as unknown[] | null) ?? []
        setTeamCount(Array.isArray(roster) ? roster.length : 0)
      })
    return () => {
      cancelled = true
    }
  }, [org?.id, isOwner])

  const patch = useCallback(
    (p: TourProgress) => {
      setProgress((cur) => ({ ...cur, ...p }))
      void saveTourProgress(SETUP_CHECKLIST_KEY, p).catch(() => {})
    },
    [],
  )

  const items = useMemo<Item[]>(() => {
    const o = org as
      | (typeof org & {
          business_address?: string | null
          business_phone?: string | null
          business_email?: string | null
          logo_url?: string | null
          invoicing_mode?: string | null
        })
      | null
    return [
      {
        key: 'company',
        // What a client actually sees on an estimate or invoice.
        done: !!(o?.business_address && (o?.business_phone || o?.business_email)),
        label: 'Add your company info',
        hint: 'Address and phone land on every estimate and invoice you send.',
        cta: 'Open settings',
        href: '/settings',
      },
      {
        key: 'logo',
        done: !!o?.logo_url,
        label: 'Upload your logo',
        hint: 'It replaces the MillSuite mark in your nav, your PDFs, and your crew’s login page.',
        cta: 'Add logo',
        href: '/settings',
      },
      {
        key: 'invoicing',
        done: o?.invoicing_mode === 'qb' || !!progress?.acked_invoicing_at,
        label: 'Choose how you invoice',
        hint: 'Bill in-house through MillSuite, or connect QuickBooks and push invoices there.',
        cta: 'Set it up',
        href: '/settings',
        onAck: () => patch({ acked_invoicing_at: new Date().toISOString() }),
      },
      {
        key: 'team',
        done: (teamCount ?? 0) > 0,
        label: 'Add your first team member',
        hint: 'Their hours drive your shop rate, your capacity, and what a job really costs.',
        cta: 'Open team',
        href: '/team',
      },
    ]
  }, [org, progress?.acked_invoicing_at, teamCount, patch])

  const doneCount = items.filter((i) => i.done).length

  if (!isOwner || !loaded) return null
  if (progress?.dismissed_at) return null
  if (doneCount === items.length) return null

  return (
    <div className="relative bg-gradient-to-br from-[#EFF6FF] to-[#DBEAFE] border border-[#BFDBFE] rounded-2xl p-5 sm:p-6 mb-6">
      <button
        onClick={() => patch({ dismissed_at: new Date().toISOString() })}
        className="absolute top-3 right-3 p-1.5 rounded-lg text-[#6B7280] hover:text-[#111] hover:bg-white/50 transition-colors"
        aria-label="Dismiss setup checklist"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-[#2563EB]" />
        <span className="text-xs font-semibold text-[#2563EB] uppercase tracking-wider">
          Getting set up
        </span>
      </div>
      <h2 className="text-lg font-semibold text-[#111] mb-1">Four things to make it yours</h2>
      <p className="text-sm text-[#6B7280] mb-4">
        {doneCount} of {items.length} complete
      </p>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.key}
            className={`flex items-start gap-3 p-3 rounded-xl border ${
              item.done ? 'bg-white/40 border-transparent' : 'bg-white border-[#E5E7EB]'
            }`}
          >
            {item.done ? (
              <CheckCircle2 className="w-5 h-5 text-[#059669] flex-shrink-0 mt-0.5" />
            ) : (
              <div className="w-5 h-5 rounded-full border-2 border-[#CBD5E1] flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div
                className={`text-sm font-medium ${
                  item.done ? 'text-[#6B7280] line-through' : 'text-[#111]'
                }`}
              >
                {item.label}
              </div>
              {!item.done && (
                <p className="text-xs text-[#6B7280] mt-0.5 leading-relaxed">{item.hint}</p>
              )}
            </div>
            {!item.done && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {item.onAck && (
                  <button
                    onClick={item.onAck}
                    className="px-2.5 py-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111] rounded-lg transition-colors whitespace-nowrap"
                  >
                    Already set
                  </button>
                )}
                {item.href && (
                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#2563EB] text-white text-xs font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors whitespace-nowrap"
                  >
                    {item.cta}
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
