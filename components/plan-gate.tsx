'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { hasAccess, getMinPlan, PLAN_LABELS } from '@/lib/feature-flags'
import { Lock } from 'lucide-react'

export default function PlanGate({ requires, children }: { requires: string; children: React.ReactNode }) {
  const { org, loading } = useAuth()

  if (loading) return null

  if (!hasAccess(org?.plan, requires)) {
    const minPlan = getMinPlan(requires)
    const planLabel = PLAN_LABELS[minPlan]

    return (
      <div className="max-w-lg mx-auto py-20 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#F3F4F6] flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6 text-[#9CA3AF]" />
        </div>
        <h2 className="text-xl font-semibold text-[#111] mb-2">
          Available on {planLabel}
        </h2>
        <p className="text-sm text-[#6B7280] mb-6 leading-relaxed">
          This feature is part of the {planLabel} plan. Upgrade to unlock scheduling, capacity planning, and more.
        </p>
        <Link
          href="/settings"
          className="inline-flex px-5 py-2.5 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors"
        >
          View plans
        </Link>
      </div>
    )
  }

  return <>{children}</>
}
