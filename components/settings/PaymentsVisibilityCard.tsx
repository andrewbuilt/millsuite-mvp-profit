'use client'

// ============================================================================
// PaymentsVisibilityCard — "Who can see payments" (migration 115)
// ============================================================================
// Owner-only, by render: this card simply doesn't exist for anyone else —
// showing an admin the list of who may see money is itself information.
//
// The picker offers roster members WITH LOGINS (the allowlist stores LOGIN
// ids, because RLS can only know auth.uid()); someone without a login can't
// query anything, so there's nothing to allow. The owner renders as a pinned
// chip — the policy lets them see regardless, and a togglable owner chip
// would imply a lockout that cannot happen.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { Eye } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { listAssignees, type TaskAssignee } from '@/lib/tasks'
import {
  loadPaymentsVisibleTo,
  savePaymentsVisibleTo,
} from '@/lib/payments-visibility'

export default function PaymentsVisibilityCard({ orgId }: { orgId: string | undefined }) {
  const { user } = useAuth()
  const [people, setPeople] = useState<TaskAssignee[]>([])
  const [list, setList] = useState<string[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOwner = user?.role === 'owner'

  useEffect(() => {
    if (!orgId || !isOwner) return
    let cancelled = false
    ;(async () => {
      const [roster, l] = await Promise.all([listAssignees(orgId), loadPaymentsVisibleTo(orgId)])
      if (cancelled) return
      setPeople(roster.filter((a) => a.userId))
      setList(l)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, isOwner])

  /** Null list = "everyone" (not configured). The first toggle CONFIGURES it:
   *  we materialise the current effective set (everyone with a login) and
   *  then apply the change, so one click doesn't silently lock out the rest
   *  of the team as a side effect. */
  const effective = useMemo(() => {
    if (list !== null) return list
    return people.map((p) => p.userId as string)
  }, [list, people])

  if (!isOwner) return null

  async function toggle(userId: string) {
    if (!orgId || saving) return
    const on = effective.includes(userId)
    const next = on ? effective.filter((x) => x !== userId) : [...effective, userId]
    setSaving(true)
    setError(null)
    try {
      await savePaymentsVisibleTo(orgId, next)
      setList(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Has migration 115 run?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <Eye className="w-4 h-4 text-[#6B7280]" /> Who can see payments
        </h2>
        <p className="text-xs text-[#9CA3AF] mt-0.5">
          The payments board, cash cards and draw schedules. Everyone else keeps contract
          totals on projects — this hides money <em>movement</em>. You always see it.
        </p>
      </div>
      <div className="px-6 py-4">
        {!loaded ? (
          <div className="text-xs text-[#9CA3AF]">Loading…</div>
        ) : people.length === 0 ? (
          <div className="text-xs text-[#9CA3AF]">
            Nobody else on the roster has a login yet — link logins on Team first.
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* The owner, pinned. */}
            <span className="text-[12px] px-2.5 py-1 rounded-full bg-[#111] text-white border border-[#111] opacity-80 cursor-default">
              {(user?.name || 'Owner').trim().split(/\s+/)[0]} (you)
            </span>
            {people
              .filter((p) => p.userId !== user?.id)
              .map((p) => {
                const on = effective.includes(p.userId as string)
                return (
                  <button
                    key={p.id}
                    onClick={() => void toggle(p.userId as string)}
                    disabled={saving}
                    className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                      on
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {p.name}
                  </button>
                )
              })}
          </div>
        )}
        {list === null && loaded && people.length > 0 && (
          <div className="mt-2 text-[11px] text-[#9CA3AF]">
            Not configured yet — everyone with a login can see payments. The first change
            you make locks the list to exactly who&rsquo;s selected.
          </div>
        )}
        {error && (
          <div className="mt-2 text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2.5 py-1.5">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
