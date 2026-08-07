'use client'

// ============================================================================
// /reset-password — where Supabase's recovery email lands
// ============================================================================
// The email itself has always existed; nothing in the app ever sent one, and
// there was no page to catch the link. Both halves ship together:
// "Forgot password?" on the three login surfaces sends the mail with
// redirectTo pointing here, and this page finishes the job.
//
// How the link works: Supabase puts a recovery token in the URL FRAGMENT
// (#access_token=…&type=recovery). supabase-js picks that up on load and
// establishes a short-lived session, which is what makes updateUser() work
// without the old password. So the whole page hinges on waiting for that
// session to appear rather than reading the URL ourselves.
//
// After a successful change the user is already signed in, so route them the
// way RoleGate would: workers to /me, everyone else to /dashboard.
// ============================================================================

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { MLogo } from '@/components/logo'

type Phase = 'checking' | 'ready' | 'saving' | 'done' | 'invalid'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  // Wait for the recovery session. supabase-js parses the URL fragment
  // asynchronously, so an immediate getSession() can race it — listen for the
  // PASSWORD_RECOVERY / SIGNED_IN event as well, and only give up after both
  // have had a chance.
  useEffect(() => {
    let settled = false
    const succeed = () => {
      if (settled) return
      settled = true
      setPhase('ready')
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) succeed()
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) succeed()
    })

    // If no session has materialised, the link is stale or already used.
    const giveUp = setTimeout(() => {
      if (!settled) {
        settled = true
        setPhase('invalid')
      }
    }, 4000)

    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(giveUp)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError("Those don't match.")
      return
    }
    setError('')
    setPhase('saving')
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      setError(err.message)
      setPhase('ready')
      return
    }
    setPhase('done')

    // Already signed in at this point — send them where their role belongs,
    // mirroring RoleGate so they don't land somewhere it bounces them off.
    const {
      data: { user },
    } = await supabase.auth.getUser()
    let landing = '/dashboard'
    if (user) {
      const { data: row } = await supabase
        .from('users')
        .select('role')
        .eq('auth_user_id', user.id)
        .maybeSingle()
      if (row?.role === 'member') landing = '/me'
    }
    setTimeout(() => router.replace(landing), 900)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#0D0D0F' }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <MLogo />
          <span className="text-white text-lg font-semibold">MillSuite</span>
        </div>

        <div className="bg-white rounded-2xl p-8">
          {phase === 'checking' && (
            <p className="text-sm text-[#6B7280] text-center">Checking your link…</p>
          )}

          {phase === 'invalid' && (
            <>
              <h1 className="text-lg font-semibold text-[#111] mb-2">This link has expired</h1>
              <p className="text-sm text-[#6B7280] mb-5 leading-relaxed">
                Password links can only be used once, and they don&apos;t last long.
                Request a new one from the sign-in page.
              </p>
              <Link
                href="/login"
                className="block w-full py-2.5 rounded-xl bg-[#2563EB] text-white text-sm font-semibold text-center hover:bg-[#1D4ED8]"
              >
                Back to sign in
              </Link>
            </>
          )}

          {phase === 'done' && (
            <>
              <h1 className="text-lg font-semibold text-[#111] mb-2">Password updated</h1>
              <p className="text-sm text-[#6B7280]">Signing you in…</p>
            </>
          )}

          {(phase === 'ready' || phase === 'saving') && (
            <>
              <h1 className="text-lg font-semibold text-[#111] mb-1">Choose a new password</h1>
              <p className="text-xs text-[#6B7280] mb-5">At least 8 characters.</p>
              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  autoComplete="new-password"
                  autoFocus
                  className="w-full px-3 py-2.5 text-sm text-[#111] placeholder:text-[#9CA3AF] border border-[#E5E7EB] rounded-xl outline-none focus:border-[#2563EB]"
                />
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  className="w-full px-3 py-2.5 text-sm text-[#111] placeholder:text-[#9CA3AF] border border-[#E5E7EB] rounded-xl outline-none focus:border-[#2563EB]"
                />
                {error && <div className="text-xs text-[#DC2626]">{error}</div>}
                <button
                  type="submit"
                  disabled={phase === 'saving'}
                  className="w-full py-2.5 rounded-xl bg-[#2563EB] text-white text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-60"
                >
                  {phase === 'saving' ? 'Saving…' : 'Set password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
