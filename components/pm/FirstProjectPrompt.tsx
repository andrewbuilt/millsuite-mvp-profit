'use client'

// ============================================================================
// FirstProjectPrompt — the "you have no jobs yet" card.
// ============================================================================
// ⛔ CARRIED OVER FROM /dashboard 2026-09-12 BECAUSE ITS ABSENCE WAS A HOLE.
// The retirement moved the checklist and the welcome toast to /pm, but this
// empty state was nearly dropped on the floor: a brand-new owner would have
// landed on a home page whose every card says "Nothing", with the checklist
// covering company info / logo / invoicing / team and NOTHING anywhere saying
// "now make a job". That's the one thing the app is for.
//
// Renders only at zero projects, so an established shop never sees it.
// ============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Settings, Target } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { hasAccess } from '@/lib/feature-flags'

export default function FirstProjectPrompt({
  orgId,
  plan,
}: {
  orgId: string | undefined
  plan: string | undefined
}) {
  // null = not yet known. ⛔ Starts null, not 0: rendering a "create your
  // first project" splash for a second before the count arrives would flash
  // it at every established shop on every load.
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const { count: n, error } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
      if (cancelled) return
      // On error, assume they HAVE projects — showing nothing is a better
      // failure than telling a shop with 40 jobs to create its first.
      setCount(error ? 1 : (n ?? 1))
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  if (count === null || count > 0) return null

  const canSell = hasAccess(plan, 'sales')

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 sm:p-10 mb-4 text-center">
      <div className="w-12 h-12 rounded-xl bg-[#EFF6FF] flex items-center justify-center mx-auto mb-4">
        <Target className="w-6 h-6 text-[#2563EB]" />
      </div>
      <h2 className="text-lg font-semibold text-[#111] mb-1">
        {canSell ? 'Drop in a bid or start a project' : 'Create your first project'}
      </h2>
      <p className="text-sm text-[#6B7280] max-w-lg mx-auto mb-5">
        {canSell
          ? 'Drop a bid PDF on the sales page and it becomes a pipeline project. Drag through the stages — Sold flips it live, and the bid-vs-actual loop turns on the moment someone logs an hour.'
          : 'A project tracks bid vs. actual so you can see profit the day it changes — not months later. Set a bid amount, log time, and watch the margin.'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {canSell ? (
          <>
            <Link
              href="/sales"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors"
            >
              <Plus className="w-4 h-4" /> New sale
            </Link>
            <Link
              href="/sales"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-[#E5E7EB] text-[#111] text-sm font-medium rounded-lg hover:bg-[#F9FAFB] transition-colors"
            >
              Drop drawings
            </Link>
          </>
        ) : (
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors"
          >
            <Plus className="w-4 h-4" /> New project
          </Link>
        )}
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
        >
          <Settings className="w-4 h-4" /> Set shop rate first
        </Link>
      </div>
    </div>
  )
}
