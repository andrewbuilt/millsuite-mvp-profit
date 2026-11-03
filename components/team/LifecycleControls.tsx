'use client'

// ============================================================================
// LifecycleControls — the /team member modal's Deactivate / Reactivate /
// Delete row (Nov batch 2 B; the model is in lib/team-lifecycle.ts)
// ============================================================================
// Delete only appears once the history check has come back EMPTY and the row
// has no login. While it loads (or if it fails) only Deactivate is offered —
// unknown history must never look deletable.
// ============================================================================

import { useEffect, useState } from 'react'
import { Power, Trash2 } from 'lucide-react'
import {
  canHardDelete,
  describeHistory,
  historyTotal,
  isActiveMember,
  memberHistory,
  type MemberHistory,
} from '@/lib/team-lifecycle'

export default function LifecycleControls({
  orgId,
  member,
  isMe,
  onDeactivate,
  onReactivate,
  onDelete,
}: {
  orgId: string
  member: { id: string; name: string; user_id?: string | null; active?: boolean | null }
  isMe: boolean
  onDeactivate: () => void
  onReactivate: () => void
  onDelete: () => void
}) {
  const [history, setHistory] = useState<MemberHistory | null>(null)
  useEffect(() => {
    let cancelled = false
    setHistory(null)
    void memberHistory(orgId, member)
      .then((h) => {
        if (!cancelled) setHistory(h)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, member.id, member.user_id])

  const active = isActiveMember(member)
  const deletable = canHardDelete(member, history)
  const summary = history && historyTotal(history) > 0 ? describeHistory(history) : null

  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <span
        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
          active ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]' : 'border-[#E5E7EB] text-[#6B7280]'
        }`}
        title="Active members count toward capacity and the shop rate"
      >
        {active ? 'Active' : 'Inactive — off pickers, capacity and PTO; can’t sign in'}
      </span>
      <div className="flex items-center gap-2">
        {active ? (
          !isMe && (
            <button
              onClick={onDeactivate}
              title={`Off every picker, capacity and PTO; login turned off.${summary ? ` Keeps ${summary}.` : ''}`}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[#E5E7EB] text-[#6B7280] hover:border-[#DC2626] hover:text-[#DC2626]"
            >
              <Power className="w-3 h-3" /> Deactivate
            </button>
          )
        ) : (
          <button
            onClick={onReactivate}
            title="Back on the roster, pickers and capacity; login turned back on"
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[#A7F3D0] text-[#065F46] hover:bg-[#ECFDF5]"
          >
            <Power className="w-3 h-3" /> Reactivate
          </button>
        )}
        {deletable && (
          <button
            onClick={onDelete}
            title="No history and no login — removes the row for good (typo / duplicate)"
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-[#9CA3AF] hover:text-[#DC2626]"
          >
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        )}
      </div>
    </div>
  )
}
