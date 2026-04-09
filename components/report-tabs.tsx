'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import { Lock } from 'lucide-react'

const TABS = [
  { key: 'outcomes', label: 'Outcomes', path: '/reports' },
  { key: 'diagnostics', label: 'Diagnostics', path: '/reports/diagnostics' },
  { key: 'trajectory', label: 'Trajectory', path: '/reports/trajectory' },
] as const

export default function ReportTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const { org } = useAuth()
  const plan = org?.plan || 'starter'

  return (
    <div className="flex gap-1 mb-6 bg-white border border-[#E5E7EB] rounded-xl p-1 w-fit">
      {TABS.map(tab => {
        const isActive = pathname === tab.path
        const isLocked = tab.key !== 'outcomes' && !hasAccess(plan, tab.key)

        return (
          <button
            key={tab.key}
            onClick={() => {
              if (!isLocked) {
                router.push(tab.path)
              }
            }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-[#F3F4F6] text-[#111]'
                : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
            }`}
          >
            {isLocked && <Lock className="w-3 h-3 text-[#9CA3AF]" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
