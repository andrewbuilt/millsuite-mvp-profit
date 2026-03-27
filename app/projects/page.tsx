'use client'

import Nav from '@/components/nav'

export default function ProjectsPage() {
  return (
    <>
      <Nav />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <button className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors">
            + New Project
          </button>
        </div>

        {/* Kanban placeholder */}
        <div className="grid grid-cols-3 gap-4">
          {['Bidding', 'Active', 'Complete'].map(col => (
            <div key={col}>
              <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">{col}</div>
              <div className="bg-[#F3F4F6] rounded-xl p-3 min-h-[300px]">
                <p className="text-xs text-[#9CA3AF] text-center py-8">No projects yet</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
