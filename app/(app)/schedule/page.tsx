'use client'

import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import Link from 'next/link'
import { Calendar } from 'lucide-react'

export default function SchedulePage() {
  return (
    <>
      <Nav />
      <PlanGate requires="schedule">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#EFF6FF] flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-6 h-6 text-[#2563EB]" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Production Schedule</h1>
          <p className="text-sm text-[#6B7280] mb-6 max-w-md mx-auto leading-relaxed">
            The swim lane production calendar is coming soon. Start by setting up your team and departments,
            then use the capacity view to plan when projects hit each department.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/team" className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors">
              Set up Team
            </Link>
            <Link href="/capacity" className="px-4 py-2 text-[#6B7280] text-sm font-medium rounded-xl border border-[#E5E7EB] hover:bg-[#F9FAFB] transition-colors">
              View Capacity
            </Link>
          </div>
        </div>
      </PlanGate>
    </>
  )
}
