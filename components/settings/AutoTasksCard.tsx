'use client'

// ============================================================================
// AutoTasksCard — "Automatic tasks" (October batch, migration 117)
// ============================================================================
// One picker per rule in lib/auto-tasks. Single choice, or Nobody (rule off).
// Offers roster members WITH LOGINS — a coordinator without a login could be
// assigned but could never open the app to see the task, which defeats the
// point of routing it to them.
// ============================================================================

import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { listAssignees, type TaskAssignee } from '@/lib/tasks'
import {
  loadAutoTaskRules,
  saveAutoTaskRules,
  type AutoTaskRule,
  type AutoTaskRules,
} from '@/lib/auto-tasks'

const RULES: { key: AutoTaskRule; label: string; hint: string }[] = [
  {
    key: 'preprod_coordinator',
    label: 'Pre-production coordinator',
    hint: 'Gets “Start pre-production · {project}” in Today when a project is first marked sold.',
  },
  {
    key: 'pto_coordinator',
    label: 'PTO coordinator',
    hint: 'Gets “PTO request · {name} · {dates}” in Today when someone requests time off.',
  },
]

export default function AutoTasksCard({ orgId }: { orgId: string | undefined }) {
  const { user } = useAuth()
  const [people, setPeople] = useState<TaskAssignee[]>([])
  const [rules, setRules] = useState<AutoTaskRules>({})
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOwner = user?.role === 'owner'

  useEffect(() => {
    if (!orgId || !isOwner) return
    let cancelled = false
    ;(async () => {
      const [roster, r] = await Promise.all([listAssignees(orgId), loadAutoTaskRules(orgId)])
      if (cancelled) return
      setPeople(roster.filter((a) => a.userId))
      setRules(r)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, isOwner])

  if (!isOwner) return null

  async function pick(rule: AutoTaskRule, rosterId: string | null) {
    if (!orgId || saving) return
    const next = { ...rules, [rule]: rosterId }
    setSaving(true)
    setError(null)
    try {
      await saveAutoTaskRules(orgId, next)
      setRules(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Has migration 117 run?')
    } finally {
      setSaving(false)
    }
  }

  const chip = (on: boolean) =>
    `text-[12px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
      on
        ? 'bg-[#2563EB] text-white border-[#2563EB]'
        : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
    }`

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#6B7280]" /> Automatic tasks
        </h2>
        <p className="text-xs text-[#9CA3AF] mt-0.5">
          Pick who gets the task. Nobody picked = no task.
        </p>
      </div>
      <div className="px-6 py-4 space-y-4">
        {!loaded ? (
          <div className="text-xs text-[#9CA3AF]">Loading…</div>
        ) : people.length === 0 ? (
          <div className="text-xs text-[#9CA3AF]">
            Nobody on the roster has a login yet — link logins on Team first.
          </div>
        ) : (
          RULES.map((r) => {
            const current = rules[r.key] ?? null
            return (
              <div key={r.key}>
                <div className="text-[13px] font-medium text-[#111]">{r.label}</div>
                <div className="text-[11px] text-[#9CA3AF] mb-1.5">{r.hint}</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => void pick(r.key, null)}
                    disabled={saving}
                    className={chip(current === null)}
                  >
                    Nobody
                  </button>
                  {people.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => void pick(r.key, p.id)}
                      disabled={saving}
                      className={chip(current === p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )
          })
        )}
        {error && (
          <div className="text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2.5 py-1.5">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
