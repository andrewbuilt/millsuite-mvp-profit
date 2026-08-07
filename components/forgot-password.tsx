'use client'

// ============================================================================
// ForgotPassword — the "Forgot password?" affordance, shared by all three
// login surfaces (/login, /{slug}, /{slug}/portal).
// ============================================================================
// Supabase's recovery email has always existed and nothing ever triggered it.
// This does: it collects an address and calls resetPasswordForEmail with
// redirectTo pointing at /reset-password, which finishes the change.
//
// Deliberately says the same thing whether or not the address has an account.
// A form that answers "no such user" is an account-enumeration oracle, and
// this one sits on a public page.
//
// `variant` only changes the palette: /login and the shop pages sit on a dark
// background, so the link has to read on both.
// ============================================================================

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function ForgotPassword({
  defaultEmail = '',
  tone = 'light',
}: {
  defaultEmail?: string
  /** 'light' = on a white card. 'dark' = on the dark page background. */
  tone?: 'light' | 'dark'
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(defaultEmail)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    // Rate limiting is worth surfacing — it's actionable ("wait a minute").
    // Anything else resolves to the same neutral confirmation.
    if (err && /rate|too many/i.test(err.message)) {
      setError(err.message)
      return
    }
    setSent(true)
  }

  const linkCls =
    tone === 'dark'
      ? 'text-xs text-white/40 hover:text-white/70'
      : 'text-xs text-[#6B7280] hover:text-[#111]'

  if (sent) {
    return (
      <p className={tone === 'dark' ? 'text-xs text-white/50' : 'text-xs text-[#6B7280]'}>
        If there&apos;s an account for that address, a reset link is on its way. It
        expires shortly, so use it soon.
      </p>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={linkCls}>
        Forgot password?
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2 w-full">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email"
        autoComplete="email"
        autoFocus
        className="w-full px-3 py-2 text-sm text-[#111] placeholder:text-[#9CA3AF] border border-[#E5E7EB] rounded-xl outline-none focus:border-[#2563EB] bg-white"
      />
      {error && <div className="text-xs text-[#DC2626]">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={linkCls}>
          Cancel
        </button>
      </div>
    </form>
  )
}
