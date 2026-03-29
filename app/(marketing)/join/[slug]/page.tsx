'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { MLogo } from '@/components/logo'

export default function JoinPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [orgName, setOrgName] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Look up org name by slug on mount
  useEffect(() => {
    async function lookupOrg() {
      const { data } = await supabase
        .from('orgs')
        .select('name')
        .eq('slug', slug)
        .single()

      if (data) {
        setOrgName(data.name)
      } else {
        setNotFound(true)
      }
    }
    if (slug) lookupOrg()
  }, [slug])

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email || !password) {
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

      // 2. Join the org via API
      const res = await fetch('/api/auth/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_user_id: authData.user.id,
          email: email.trim().toLowerCase(),
          name: name.trim(),
          slug,
        }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to join')

      // 3. Redirect to time tracking (most relevant for shop floor)
      router.push('/time')
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-xl font-bold text-white mb-2">Shop not found</h1>
          <p className="text-sm text-[#8B8B96]">This invite link isn't valid. Ask your shop owner for a new one.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]" style={{ background: 'rgba(13,13,15,0.8)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
            <MLogo size={22} color="white" /> MillSuite
          </Link>
        </div>
      </nav>

      <div className="min-h-screen flex items-center justify-center px-6 pt-16">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">
              Join {orgName || '...'}
            </h1>
            <p className="text-sm text-[#8B8B96]">Create your account to start tracking time</p>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#8B8B96] mb-1.5">Your Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Mike Johnson"
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
                placeholder="you@email.com"
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
              disabled={loading || !orgName}
              className="w-full px-6 py-3 bg-[#D4956A] text-white font-medium rounded-xl hover:bg-[#C4855A] transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Join team'}
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
