'use client'

import Nav from '@/components/nav'

export default function DashboardPage() {
  return (
    <>
      <Nav />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight mb-6">Dashboard</h1>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center text-[#9CA3AF]">
          <p className="text-sm">Set up your shop rate to get started</p>
          <a href="/settings" className="inline-block mt-3 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]">
            Go to Settings →
          </a>
        </div>
      </div>
    </>
  )
}
