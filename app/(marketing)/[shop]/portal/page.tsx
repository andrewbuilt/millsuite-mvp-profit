'use client'

// ============================================================================
// /{shop}/portal — shop-branded employee login (vanity URL for the worker
// app). Mirrors /join/[slug]: look up the org by slug for branding, then
// sign the worker in. On success they land on /me (RoleGate keeps members
// there). Lives under the (marketing) group, so no app chrome / onboarding.
// ============================================================================

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { MLogo } from '@/components/logo'

export default function PortalPage() {
  const params = useParams()
  const router = useRouter()
  const shop = params.shop as string

  const [orgName, setOrgName] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Already signed in? Go straight to the worker app.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) router.replace('/me')
    })
  }, [router])

  // Look up the shop by slug for branding + a friendly 404.
  useEffect(() => {
    if (!shop) return
    supabase
      .from('orgs')
      .select('name')
      .eq('slug', shop)
      .single()
      .then(({ data }) => {
        if (data) setOrgName(data.name)
        else setNotFound(true)
      })
  }, [shop])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      setError('Enter your email and password')
      return
    }
    setError('')
    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (authError) throw authError
      // Members land on /me via RoleGate; owners can navigate from there.
      router.push('/me')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#0D0D0F' }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <MLogo />
          <span className="text-white text-lg font-semibold">MillSuite</span>
        </div>

        {notFound ? (
          <div className="bg-white rounded-2xl p-8 text-center">
            <h1 className="text-lg font-semibold text-[#111] mb-2">Shop not found</h1>
            <p className="text-sm text-[#6B7280]">
              We couldn&apos;t find a shop at this link. Double-check the address with your
              employer.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-8">
            <div className="mb-6 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-1">
                Employee sign in
              </div>
              <h1 className="text-xl font-semibold text-[#111]">{orgName || 'Loading…'}</h1>
            </div>

            <form onSubmit={handleLogin} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                className="w-full px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-xl outline-none focus:border-[#2563EB]"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-xl outline-none focus:border-[#2563EB]"
              />
              {error && <div className="text-xs text-[#DC2626]">{error}</div>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-[#2563EB] text-white text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="text-[11px] text-[#9CA3AF] text-center mt-4">
              Don&apos;t have a login? Ask your shop owner to set one up on the Team page.
            </p>
          </div>
        )}

        <div className="text-center mt-6">
          <Link href="/login" className="text-xs text-white/40 hover:text-white/70">
            Owner login →
          </Link>
        </div>
      </div>
    </div>
  )
}
