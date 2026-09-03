'use client'

// ============================================================================
// ChangePassword — set a new password while signed in.
// ============================================================================
// Used by Settings (owner/admin) and the /me worker app. Same component both
// places so the rules can't drift.
//
// Supabase's updateUser() doesn't ask for the current password — the session
// is the proof of identity. We ask for it anyway and verify it by re-signing
// in first, because a signed-in unattended phone on a shop floor is a real
// scenario and "anyone who walks past can change the password" is not the
// behaviour to ship.
// ============================================================================

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function ChangePassword({ email }: { email: string | null | undefined }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function reset() {
    setCurrent('')
    setNext('')
    setConfirm('')
    setError('')
    setOpen(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) {
      setError('No email on this account — ask the shop owner to reset it for you.')
      return
    }
    if (next.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (next !== confirm) {
      setError("Those don't match.")
      return
    }
    setBusy(true)
    setError('')

    // Prove it's really them before changing anything.
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    })
    if (signInErr) {
      setBusy(false)
      setError('Current password is incorrect.')
      return
    }

    const { error: updErr } = await supabase.auth.updateUser({ password: next })
    setBusy(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    setDone(true)
    reset()
    setTimeout(() => setDone(false), 4000)
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-[#111]">Password</div>
          {done && <div className="text-[11px] text-[#15803D]">Updated</div>}
        </div>
        {/* 44px tall on phones only. This renders in TWO places — /me (the
            worker phone app, where it needs a real tap target) and /settings
            on a desktop, where a 44px-tall bordered button next to 27px rows
            looks wrong. `sm:` resets it above 640px. */}
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] px-2 py-1 min-h-[44px] sm:min-h-0 rounded-md border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]"
        >
          Change password
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="text-[13px] text-[#111]">Change password</div>
      <input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Current password"
        autoComplete="current-password"
        autoFocus
        className="w-full px-2.5 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
      />
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="New password (8+ characters)"
        autoComplete="new-password"
        className="w-full px-2.5 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm new password"
        autoComplete="new-password"
        className="w-full px-2.5 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
      />
      {error && <div className="text-[11px] text-[#DC2626]">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Update password'}
        </button>
        <button type="button" onClick={reset} className="text-xs text-[#6B7280] hover:text-[#111]">
          Cancel
        </button>
      </div>
    </form>
  )
}
