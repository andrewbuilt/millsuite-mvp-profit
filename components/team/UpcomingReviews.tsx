'use client'

// ============================================================================
// UpcomingReviews — /team's "Reviews · next 30 days" (Nov batch 2, item 5)
// ============================================================================
// Andrew's default for reminders: the review's author gets a Today task 7
// days before and on the day; this list is the month view (Evan's ask) —
// every scheduled, not-held review in the next 30 days, soonest first.
// Managers only (the caller gates it). Clicking a row opens that person's
// editor, where the review lives. Renders nothing when nothing's scheduled.
// ============================================================================

import { useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { listReviews, reviewsInWindow, todayISO, type EmployeeReview } from '@/lib/employee-reviews'

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function UpcomingReviews({
  orgId,
  nameById,
  onOpenMember,
  refreshKey,
}: {
  orgId: string
  nameById: Record<string, string>
  onOpenMember: (memberId: string) => void
  /** Bump to reload (e.g. after the member modal closes). */
  refreshKey?: unknown
}) {
  const [rows, setRows] = useState<EmployeeReview[]>([])
  useEffect(() => {
    let cancelled = false
    void listReviews(orgId)
      .then((r) => {
        if (!cancelled) setRows(reviewsInWindow(r, todayISO(), 30))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [orgId, refreshKey])

  if (rows.length === 0) return null
  const today = todayISO()
  return (
    <div className="mb-6 bg-white border border-[#E5E7EB] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardCheck className="w-4 h-4 text-[#2563EB]" />
        <h2 className="text-sm font-semibold text-[#111]">Reviews · next 30 days</h2>
      </div>
      <div className="divide-y divide-[#F3F4F6]">
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => onOpenMember(r.member_id)}
            className="w-full flex items-center justify-between gap-3 py-1.5 text-left hover:bg-[#F9FAFB] rounded"
          >
            <span className="text-[12.5px] text-[#111] truncate">{nameById[r.member_id] || 'Former team member'}</span>
            <span
              className={`text-[11.5px] tabular-nums flex-shrink-0 ${
                r.scheduled_at === today ? 'text-[#2563EB] font-semibold' : 'text-[#6B7280]'
              }`}
            >
              {r.scheduled_at === today ? 'Today' : fmtDate(r.scheduled_at as string)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
