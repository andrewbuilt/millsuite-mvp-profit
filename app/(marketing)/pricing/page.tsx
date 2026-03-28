'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, ArrowLeft } from 'lucide-react'

function WaitlistForm({ tier, onClose }: { tier: string; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSaving(true)
    // TODO: Save to Supabase waitlist table + Klaviyo
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), tier }),
      })
    } catch {}
    setSubmitted(true)
    setSaving(false)
  }

  if (submitted) {
    return (
      <div className="text-center py-4">
        <div className="text-sm font-medium text-[#D4956A] mb-1">You're on the list.</div>
        <p className="text-xs text-[#555]">We'll email you when {tier} is ready.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@yourshop.com"
        required
        className="flex-1 px-3 py-2 bg-white/[0.05] border border-white/[0.1] rounded-lg text-sm text-white placeholder:text-[#555] outline-none focus:border-[#D4956A]/50"
      />
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 bg-white/[0.08] border border-white/[0.1] text-sm font-medium text-white rounded-lg hover:bg-white/[0.12] transition-colors disabled:opacity-50"
      >
        {saving ? '...' : 'Notify me'}
      </button>
    </form>
  )
}

export default function PricingPage() {
  const [showWaitlist, setShowWaitlist] = useState<string | null>(null)

  return (
    <>
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]" style={{ background: 'rgba(13,13,15,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="text-lg font-semibold tracking-tight text-white">
            MillSuite
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm text-[#8B8B96] hover:text-white transition-colors">
              Home
            </Link>
            <Link href="/login" className="text-sm text-[#8B8B96] hover:text-white transition-colors">
              Log in
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-8 px-6 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-4">
          Simple pricing. No surprises.
        </h1>
        <p className="text-lg text-[#8B8B96] max-w-2xl mx-auto leading-relaxed">
          We're not going to charge you extra to add a team member or see your own reports.
          Start with what you need today.
        </p>
      </section>

      {/* Tiers */}
      <section className="py-12 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* ── STARTER ── */}
          <div className="rounded-2xl border-2 border-[#D4956A]/40 bg-[#D4956A]/[0.03] p-6 relative">
            <div className="absolute -top-3 left-6 px-3 py-0.5 bg-[#D4956A] text-white text-[10px] font-semibold uppercase tracking-wider rounded-full">
              Available now
            </div>
            <div className="mb-6 pt-2">
              <h3 className="text-xl font-bold text-white mb-1">Starter</h3>
              <p className="text-sm text-[#8B8B96]">For shops that need to know their numbers.</p>
            </div>
            <div className="mb-6">
              <span className="text-4xl font-bold font-mono text-white">$39</span>
              <span className="text-[#8B8B96]">/month</span>
            </div>

            <ul className="space-y-3 mb-8">
              {[
                'Shop rate calculator',
                'Unlimited projects',
                'Real-time project P&L',
                'Subproject bidding with margin controls',
                'Time tracking — timer + manual',
                'Invoice parsing (AI-powered)',
                'Team cost tracking (billable/non-billable)',
                'Unlimited team members',
              ].map(f => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#D4956A] flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-[#C8C8D0]">{f}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/api/checkout"
              className="block w-full text-center px-6 py-3 bg-[#D4956A] text-white font-medium rounded-xl hover:bg-[#C4855A] transition-colors"
            >
              Start free for 14 days
            </Link>
            <p className="text-[10px] text-[#555] text-center mt-2">No credit card required</p>
          </div>

          {/* ── PRO ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div className="mb-6">
              <h3 className="text-xl font-bold text-white mb-1">Pro</h3>
              <p className="text-sm text-[#8B8B96]">For shops with crews to manage and margin to protect.</p>
            </div>
            <div className="mb-6">
              <span className="text-lg font-semibold text-[#8B8B96]">Coming soon</span>
            </div>

            <ul className="space-y-3 mb-8">
              {[
                'Everything in Starter',
                'Production scheduling',
                'Capacity planning',
                'Change order tracking',
                'QuickBooks sync',
                'Pre-production approvals',
              ].map(f => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#555] flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-[#8B8B96]">{f}</span>
                </li>
              ))}
            </ul>

            {showWaitlist === 'pro' ? (
              <WaitlistForm tier="Pro" onClose={() => setShowWaitlist(null)} />
            ) : (
              <button
                onClick={() => setShowWaitlist('pro')}
                className="block w-full text-center px-6 py-3 bg-white/[0.06] border border-white/[0.1] text-white font-medium rounded-xl hover:bg-white/[0.1] transition-colors"
              >
                Join the waitlist
              </button>
            )}
          </div>

          {/* ── TEAM ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div className="mb-6">
              <h3 className="text-xl font-bold text-white mb-1">Team</h3>
              <p className="text-sm text-[#8B8B96]">For shops running at scale that need everything in one place.</p>
            </div>
            <div className="mb-6">
              <span className="text-lg font-semibold text-[#8B8B96]">Coming soon</span>
            </div>

            <ul className="space-y-3 mb-8">
              {[
                'Everything in Pro',
                'AI estimating from drawings',
                'Client-facing portal',
                'Custom reporting',
                'Google Drive integration',
                'Priority support',
              ].map(f => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#555] flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-[#8B8B96]">{f}</span>
                </li>
              ))}
            </ul>

            {showWaitlist === 'team' ? (
              <WaitlistForm tier="Team" onClose={() => setShowWaitlist(null)} />
            ) : (
              <button
                onClick={() => setShowWaitlist('team')}
                className="block w-full text-center px-6 py-3 bg-white/[0.06] border border-white/[0.1] text-white font-medium rounded-xl hover:bg-white/[0.1] transition-colors"
              >
                Join the waitlist
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Trial section */}
      <section className="py-16 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Try it free for 14 days.</h2>
          <p className="text-[#8B8B96] leading-relaxed mb-6">
            No credit card. No sales pitch. Just set up your first project and see if it clicks.
            Most shops are up and running in under an hour.
          </p>
          <p className="text-sm text-[#555]">
            After the trial, pick a plan or don't. We're not going to chase you down.
          </p>
        </div>
      </section>

      {/* Early adopter note */}
      <section className="py-12 px-6 border-t border-white/[0.04]">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#D4956A]/20 bg-[#D4956A]/5 mb-4">
            <span className="text-xs font-medium text-[#D4956A]">Early adopter pricing</span>
          </div>
          <p className="text-sm text-[#8B8B96] leading-relaxed">
            Sign up now and your $39/mo rate is locked in — even when we raise prices later.
            Early adopters keep their price forever.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-white">MillSuite</span>
            <span className="text-xs text-[#555]">© 2026</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-[#555]">
            <a href="mailto:info@millsuite.com" className="hover:text-[#8B8B96] transition-colors">info@millsuite.com</a>
            <Link href="/" className="hover:text-[#8B8B96] transition-colors">Home</Link>
          </div>
        </div>
      </footer>
    </>
  )
}
