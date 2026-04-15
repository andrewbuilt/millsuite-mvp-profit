'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Users } from 'lucide-react'
import { MLogo } from '@/components/logo'

function WaitlistForm({ tier, onClose }: { tier: string; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSaving(true)
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
        <p className="text-xs text-[#555]">We'll email you when it's ready.</p>
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

function SeatCalculator({ pricePerSeat, minSeats }: { pricePerSeat: number; minSeats: number }) {
  const [seats, setSeats] = useState(minSeats)
  const total = seats * pricePerSeat

  return (
    <div className="mt-4 p-4 bg-white/[0.03] border border-white/[0.06] rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs text-[#8B8B96] flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Team size
        </label>
        <span className="text-xs text-[#555]">{minSeats} seat minimum</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={minSeats}
          max={50}
          value={seats}
          onChange={e => setSeats(parseInt(e.target.value))}
          className="flex-1 accent-[#D4956A]"
        />
        <span className="text-sm font-mono text-white w-8 text-right">{seats}</span>
      </div>
      <div className="mt-3 text-center">
        <span className="text-2xl font-bold font-mono text-white">${total}</span>
        <span className="text-[#8B8B96]">/mo</span>
        <span className="text-xs text-[#555] ml-2">({seats} seats &times; ${pricePerSeat})</span>
      </div>
    </div>
  )
}

export default function PricingPage() {
  const [showWaitlist, setShowWaitlist] = useState<string | null>(null)

  return (
    <>
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]" style={{ background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-6 flex items-center justify-between h-14 sm:h-16">
          <Link href="/" className="flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight text-white">
            <MLogo size={20} color="white" />
            MillSuite
          </Link>
          <div className="flex items-center gap-4 sm:gap-6">
            <Link href="/" className="text-sm text-[#8B8B96] hover:text-white transition-colors hidden sm:inline">Home</Link>
            <Link href="/login" className="text-sm text-[#8B8B96] hover:text-white transition-colors">Log in</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-24 sm:pt-32 pb-6 sm:pb-8 px-5 sm:px-6 text-center">
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white mb-4">
          Per-seat pricing. Scales with your shop.
        </h1>
        <p className="text-base sm:text-lg text-[#8B8B96] max-w-2xl mx-auto leading-relaxed">
          Less than what most shops spend per person on software that doesn't even talk to each other.
        </p>
      </section>

      {/* Tiers */}
      <section className="py-8 sm:py-12 px-5 sm:px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5">

          {/* ── STARTER ── */}
          <div className="rounded-2xl border-2 border-[#D4956A]/40 bg-[#D4956A]/[0.03] p-6 relative">
            <div className="absolute -top-3 left-6 px-3 py-0.5 bg-[#D4956A] text-white text-[10px] font-semibold uppercase tracking-wider rounded-full">
              Available now
            </div>
            <div className="mb-5 pt-2">
              <h3 className="text-xl font-bold text-white mb-1">Starter</h3>
              <p className="text-sm text-[#8B8B96]">Know your numbers on every job.</p>
            </div>
            <div className="mb-2">
              <span className="text-4xl font-bold font-mono text-white">$12</span>
              <span className="text-[#8B8B96]">/seat/mo</span>
            </div>
            <p className="text-xs text-[#555] mb-4">1 seat minimum. Solo owner: $12/mo.</p>

            <ul className="space-y-2.5 mb-6">
              {[
                'Project profit tracking (real-time P&L)',
                'Time tracking with start/stop timer',
                'Invoice parsing (AI-powered)',
                'Basic reporting and outcomes',
                'Shop rate calculator (unlimited)',
                '3 takeoff parses/seat/mo',
                '2 AI reports/seat/mo',
                'Unlimited projects and team members',
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

            <SeatCalculator pricePerSeat={12} minSeats={1} />
          </div>

          {/* ── PRO ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div className="mb-5">
              <h3 className="text-xl font-bold text-white mb-1">Pro</h3>
              <p className="text-sm text-[#8B8B96]">Schedule work. Manage crews. Protect margin.</p>
            </div>
            <div className="mb-2">
              <span className="text-4xl font-bold font-mono text-white">$24</span>
              <span className="text-[#8B8B96]">/seat/mo</span>
            </div>
            <p className="text-xs text-[#555] mb-4">3 seat minimum. 5-person shop: $120/mo.</p>

            <ul className="space-y-2.5 mb-6">
              {[
                'Everything in Starter',
                'Production scheduling',
                'Capacity planning (drag-and-drop)',
                'Department-level tracking',
                'Team management',
                'Unlimited takeoff parses',
                '10 AI reports/seat/mo',
                'Client portal',
                'Pre-production approvals',
                'QuickBooks + Google Drive sync',
              ].map(f => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#D4956A] flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-[#C8C8D0]">{f}</span>
                </li>
              ))}
            </ul>

            {showWaitlist === 'pro' ? (
              <WaitlistForm tier="pro" onClose={() => setShowWaitlist(null)} />
            ) : (
              <button
                onClick={() => setShowWaitlist('pro')}
                className="block w-full text-center px-6 py-3 bg-white/[0.06] border border-white/[0.1] text-white font-medium rounded-xl hover:bg-white/[0.1] transition-colors"
              >
                Join the waitlist
              </button>
            )}

            <SeatCalculator pricePerSeat={24} minSeats={3} />
          </div>

          {/* ── PRO + AI ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div className="mb-5">
              <h3 className="text-xl font-bold text-white mb-1">Pro + AI</h3>
              <p className="text-sm text-[#8B8B96]">The full system. AI that learns your shop.</p>
            </div>
            <div className="mb-2">
              <span className="text-4xl font-bold font-mono text-white">$32</span>
              <span className="text-[#8B8B96]">/seat/mo</span>
            </div>
            <p className="text-xs text-[#555] mb-4">5 seat minimum. 14-person shop: $448/mo.</p>

            <ul className="space-y-2.5 mb-6">
              {[
                'Everything in Pro',
                'AI estimating engine',
                'Learning loop (system learns YOUR shop)',
                'Unlimited AI reports',
                'Financial dashboards + cash flow',
                'Custom reporting',
                'Priority support',
              ].map(f => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#D4956A] flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-[#C8C8D0]">{f}</span>
                </li>
              ))}
            </ul>

            {showWaitlist === 'pro-ai' ? (
              <WaitlistForm tier="pro-ai" onClose={() => setShowWaitlist(null)} />
            ) : (
              <button
                onClick={() => setShowWaitlist('pro-ai')}
                className="block w-full text-center px-6 py-3 bg-white/[0.06] border border-white/[0.1] text-white font-medium rounded-xl hover:bg-white/[0.1] transition-colors"
              >
                Join the waitlist
              </button>
            )}

            <SeatCalculator pricePerSeat={32} minSeats={5} />
          </div>
        </div>
      </section>

      {/* Comparison vs status quo */}
      <section className="py-10 sm:py-14 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-xl font-bold text-white mb-6">You're already paying more for less</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
              <div className="text-xs text-[#555] uppercase tracking-wide mb-2">Typical 10-person shop today</div>
              <div className="text-sm text-[#8B8B96] space-y-1">
                <div className="flex justify-between"><span>GSuite</span><span className="font-mono text-white">$144/mo</span></div>
                <div className="flex justify-between"><span>Harvest</span><span className="font-mono text-white">$108/mo</span></div>
                <div className="flex justify-between"><span>QuickBooks</span><span className="font-mono text-white">$80/mo</span></div>
                <div className="flex justify-between"><span>Spreadsheets</span><span className="font-mono text-white">$0 + your sanity</span></div>
                <div className="flex justify-between border-t border-white/[0.06] pt-1 mt-1"><span className="font-medium text-white">Total</span><span className="font-mono font-bold text-white">$332+/mo</span></div>
              </div>
              <p className="text-xs text-[#555] mt-3">None of these tools talk to each other. No profit tracking. No learning loop.</p>
            </div>
            <div className="rounded-xl border border-[#D4956A]/20 bg-[#D4956A]/[0.03] p-5">
              <div className="text-xs text-[#D4956A] uppercase tracking-wide mb-2">MillSuite Pro (10 seats)</div>
              <div className="text-3xl font-bold font-mono text-white mb-1">$240<span className="text-lg text-[#8B8B96]">/mo</span></div>
              <p className="text-sm text-[#C8C8D0]">Everything in one system. Real-time P&L. Scheduling. Time tracking. Integrations.</p>
              <p className="text-xs text-[#D4956A] mt-3">Replaces your entire stack for less.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Free tools */}
      <section className="py-10 sm:py-12 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-xl font-bold text-white mb-4">Not ready to pay? Start free.</h2>
          <p className="text-sm text-[#8B8B96] leading-relaxed mb-6">
            Calculate your real shop rate. Parse a few drawings. No account needed for the basics.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="https://tools.millsuite.com" className="px-5 py-2.5 bg-white/[0.06] border border-white/[0.1] text-sm font-medium text-white rounded-xl hover:bg-white/[0.1] transition-colors">
              Shop Rate Calculator
            </a>
            <a href="https://takeoff.millsuite.com" className="px-5 py-2.5 bg-white/[0.06] border border-white/[0.1] text-sm font-medium text-white rounded-xl hover:bg-white/[0.1] transition-colors">
              PDF Takeoff (3 free parses)
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-6 sm:py-8 px-5 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <MLogo size={16} color="white" />
            <span className="text-sm font-semibold text-white">MillSuite</span>
            <span className="text-xs text-[#555]">&copy; 2026</span>
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
