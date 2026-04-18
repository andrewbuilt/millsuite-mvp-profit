'use client'

import { useState } from 'react'
import { MLogo } from '@/components/logo'

export default function PortalLogin({
  slug,
  projectName,
  clientName,
}: {
  slug: string
  projectName: string
  clientName: string | null
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/${slug}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || 'Incorrect password')
        setLoading(false)
        return
      }
      // Reload to let the server render the authenticated view
      window.location.reload()
    } catch (err: any) {
      setError(err?.message || 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <MLogo size={28} color="#111" />
          <span className="text-xl font-semibold tracking-tight text-[#111]">MillSuite</span>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
          <div className="mb-6">
            <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
              Client Portal
            </div>
            <h1 className="text-xl font-semibold text-[#111] tracking-tight">
              {projectName}
            </h1>
            {clientName && (
              <p className="text-sm text-[#6B7280] mt-1">{clientName}</p>
            )}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                Access Code
              </label>
              <input
                type="text"
                autoFocus
                autoCapitalize="characters"
                value={password}
                onChange={e => setPassword(e.target.value.toUpperCase())}
                placeholder="ABCD23"
                className="mt-1 w-full px-3 py-2.5 text-base font-mono tracking-widest border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                disabled={loading}
              />
            </div>
            {error && (
              <div className="text-sm text-[#DC2626] bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="w-full px-4 py-2.5 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-xs text-[#9CA3AF] text-center mt-6">
          Don't have your access code? Contact your project lead.
        </p>
      </div>
    </div>
  )
}
