'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { MLogo } from '@/components/logo'
import {
  PLAN_LABELS,
  PLAN_SEAT_PRICE,
  validatePlan,
  type Plan,
} from '@/lib/feature-flags'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shopName, setShopName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Plan picked on /pricing — read from ?plan= on mount via the
  // browser-side URL so we don't need a Suspense boundary around
  // useSearchParams. validatePlan returns null on anything outside
  // the live PLANS list (incl. legacy 'trial'); 'starter' is the
  // documented fallback.
  const [plan, setPlan] = useState<Plan>('starter')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const param = new URLSearchParams(window.location.search).get('plan')
    const v = validatePlan(param)
    if (v) setPlan(v)
  }, [])

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password || !shopName.trim()) {
      setError('All fields are required')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setError('')
    setLoading(true)

    try {
      // 1. Create Supabase auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      })

      if (authError) throw authError
      if (!authData.user) throw new Error('Signup failed')

      // 2. Create org + user via API (uses service role key)
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_user_id: authData.user.id,
          email: email.trim().toLowerCase(),
          shop_name: shopName.trim(),
          plan,
        }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to create account')

      // 3. Redirect to dashboard
      router.push('/dashboard?welcome=true')
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const planLabel = PLAN_LABELS[plan]
  const planPrice = PLAN_SEAT_PRICE[plan]

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]" style={{ background: 'rgba(13,13,15,0.8)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white"><MLogo size={22} color="white" /> MillSuite</Link>
          <Link href="/login" className="text-sm text-[#8B8B96] hover:text-white transition-colors">Log in</Link>
        </div>
      </nav>

      <div className="min-h-screen flex items-center justify-center px-6 pt-16">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
            <p className="text-sm text-[#8B8B96]">
              Signing up for{' '}
              <span className="text-[#D4956A] font-semibold">{planLabel}</span>
              {' · '}
              <span className="font-mono">${planPrice}/seat/mo</span>
            </p>
            <p className="text-xs text-[#555] mt-1">
              Not the right tier?{' '}
              <Link href="/pricing" className="text-[#D4956A] hover:text-[#C4855A]">
                See pricing →
              </Link>
            </p>
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#8B8B96] mb-1.5">Shop Name</label>
              <input
                type="text"
                value={shopName}
                onChange={e => setShopName(e.target.value)}
                placeholder="e.g. Watson Woodworks"
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-sm text-white placeholder:text-[#555] outline-none focus:border-[#D4956A]/50 focus:ring-1 focus:ring-[#D4956A]/20 transition-colors"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8B8B96] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourshop.com"
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-sm text-white placeholder:text-[#555] outline-none focus:border-[#D4956A]/50 focus:ring-1 focus:ring-[#D4956A]/20 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8B8B96] mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-sm text-white placeholder:text-[#555] outline-none focus:border-[#D4956A]/50 focus:ring-1 focus:ring-[#D4956A]/20 transition-colors"
              />
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-[#D4956A] text-white font-medium rounded-xl hover:bg-[#C4855A] transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account...' : `Create ${planLabel} account`}
            </button>
          </form>

          <p className="text-center text-xs text-[#555] mt-6">
            Already have an account? <Link href="/login" className="text-[#D4956A] hover:text-[#C4855A]">Log in</Link>
          </p>
        </div>
      </div>
    </>
  )
}
