'use client'

// ============================================================================
// ShopLogin — shop-branded login used by the org vanity URLs:
//   /{shop}          → manager/owner login  → lands in the full app
//   /{shop}/portal   → employee login       → lands on /me
// Both look up the org by slug for branding + a friendly 404, then sign in.
// RoleGate still has the final say on where a given role can be, so a worker
// who uses the manager URL is bounced to /me and vice-versa.
// ============================================================================

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { MLogo } from '@/components/logo'

export default function ShopLogin({ variant }: { variant: 'manager' | 'employee' }) {
  const params = useParams()
  const router = useRouter()
  const shop = params.shop as string
  const landing = variant === 'employee' ? '/me' : '/dashboard'

  const [orgName, setOrgName] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Already signed in? Skip the form.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) router.replace(landing)
    })
  }, [router, landing])

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
      router.push(landing)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  const kicker = variant === 'employee' ? 'Employee sign in' : 'Sign in'

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
              We couldn&apos;t find a shop at this link. Double-check the address.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-8">
            <div className="mb-6 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-1">
                {kicker}
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
                className="w-full px-3 py-2.5 text-sm text-[#111] placeholder:text-[#9CA3AF] border border-[#E5E7EB] rounded-xl outline-none focus:border-[#2563EB]"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full px-3 py-2.5 text-sm text-[#111] placeholder:text-[#9CA3AF] border border-[#E5E7EB] rounded-xl outline-none focus:border-[#2563EB]"
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

            {variant === 'employee' && (
              <p className="text-[11px] text-[#9CA3AF] text-center mt-4">
                Don&apos;t have a login? Ask your shop owner to set one up on the Team page.
              </p>
            )}
          </div>
        )}

        <div className="text-center mt-6">
          {variant === 'employee' ? (
            <Link href={`/${shop}`} className="text-xs text-white/40 hover:text-white/70">
              Manager login →
            </Link>
          ) : (
            <Link href={`/${shop}/portal`} className="text-xs text-white/40 hover:text-white/70">
              Employee time-tracking login →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
