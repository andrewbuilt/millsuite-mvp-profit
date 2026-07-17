'use client'

// ============================================================================
// /me — worker phone app (skeleton). Chunk A3 lands the route + role-based
// landing (members bounce here via RoleGate); chunk D builds the real
// screens (Today / clocked-in / My week / PTO / History) + PWA polish.
// ============================================================================

import { useAuth } from '@/lib/auth-context'

export default function MePage() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">
        Loading…
      </div>
    )
  }

  const firstName = (user?.name || '').trim().split(/\s+/)[0] || 'there'

  return (
    <div className="max-w-md mx-auto px-5 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Hi {firstName}</h1>
      <p className="text-sm text-[#6B7280] mt-1">This is your work app.</p>

      <div className="mt-6 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-6 text-center">
        <p className="text-sm text-[#6B7280]">
          Time tracking, your week, and PTO are coming here soon.
        </p>
      </div>
    </div>
  )
}
