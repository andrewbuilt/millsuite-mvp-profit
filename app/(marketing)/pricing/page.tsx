'use client'

// /pricing — three tiers, each card's "Sign up" routes to
// /signup?plan=<key>. No Stripe; payment is out-of-band. Per-seat
// prices come from lib/feature-flags.PLAN_SEAT_PRICE so this page
// auto-reflects future price changes — only the feature-list copy
// lives inline here. No future-features section: every line below
// is live in the named tier today.

import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { MLogo } from '@/components/logo'
import { PLAN_SEAT_PRICE, type Plan } from '@/lib/feature-flags'

interface TierCard {
  key: Plan
  name: string
  tagline: string
  features: string[]
  highlight?: boolean
}

const TIERS: TierCard[] = [
  {
    key: 'starter',
    name: 'Starter',
    tagline: 'Profit-first basics',
    features: [
      'Shop rate calculator',
      'Projects + subproject pricing',
      'Time tracking (desktop + mobile)',
      'Printable estimates',
      'Invoice parsing',
      '2 AI shop reports / seat / mo',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    tagline: 'Run the whole shop',
    features: [
      'Everything in Starter',
      'Leads Kanban + sold handoff',
      'Pre-production selections',
      'Client portal w/ sign-off',
      'Department scheduling + capacity',
      'Team roles + rate book',
    ],
    highlight: true,
  },
  {
    key: 'pro-ai',
    name: 'Pro + AI',
    tagline: 'Early access to AI',
    features: [
      'Everything in Pro',
      'Unlimited AI shop reports',
      'Priority support',
      'AI estimating (drawing parser)',
      'Learning loop',
      'Custom AI reports',
    ],
  },
]

export default function PricingPage() {
  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]"
        style={{
          background: 'rgba(10,10,10,0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-6 flex items-center justify-between h-14 sm:h-16">
          <Link
            href="/"
            className="flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight text-white"
          >
            <MLogo size={20} color="white" />
            MillSuite
          </Link>
          <div className="flex items-center gap-4 sm:gap-6">
            <Link
              href="/"
              className="text-sm text-[#8B8B96] hover:text-white transition-colors hidden sm:inline"
            >
              Home
            </Link>
            <Link
              href="/login"
              className="text-sm text-[#8B8B96] hover:text-white transition-colors"
            >
              Log in
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-24 sm:pt-32 pb-6 sm:pb-8 px-5 sm:px-6 text-center">
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white mb-4">
          One system. Per seat. No surprises.
        </h1>
        <p className="text-base sm:text-lg text-[#8B8B96] max-w-2xl mx-auto leading-relaxed">
          Pick the tier that matches the work your shop does today. Upgrade
          when you grow into the next one.
        </p>
      </section>

      {/* Tiers */}
      <section className="py-8 sm:py-12 px-5 sm:px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5">
          {TIERS.map((tier) => {
            const price = PLAN_SEAT_PRICE[tier.key]
            const containerClass = tier.highlight
              ? 'rounded-2xl border-2 border-[#D4956A]/40 bg-[#D4956A]/[0.03] p-6 relative'
              : 'rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6'
            return (
              <div key={tier.key} className={containerClass}>
                {tier.highlight && (
                  <div className="absolute -top-3 left-6 px-3 py-0.5 bg-[#D4956A] text-white text-[10px] font-semibold uppercase tracking-wider rounded-full">
                    Most popular
                  </div>
                )}
                <div className="mb-5 pt-2">
                  <h3 className="text-xl font-bold text-white mb-1">{tier.name}</h3>
                  <p className="text-sm text-[#8B8B96]">{tier.tagline}</p>
                </div>
                <div className="mb-5">
                  <span className="text-3xl font-bold text-white font-mono tabular-nums">
                    ${price}
                  </span>
                  <span className="text-sm text-[#8B8B96] ml-1.5">/seat/mo</span>
                </div>
                <ul className="space-y-2.5 mb-6">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-[#D4956A] flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-[#C8C8D0]">{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/signup?plan=${tier.key}`}
                  className={`block w-full text-center px-6 py-3 font-medium rounded-xl transition-colors ${
                    tier.highlight
                      ? 'bg-[#D4956A] text-white hover:bg-[#C4855A]'
                      : 'bg-white/[0.06] border border-white/[0.1] text-white hover:bg-white/[0.1]'
                  }`}
                >
                  Sign up
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="py-14 sm:py-20 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-xl font-bold text-white mb-3">
            Not sure which tier?
          </h2>
          <p className="text-sm text-[#8B8B96] leading-relaxed mb-6 max-w-xl mx-auto">
            Most one- or two-person shops start on Starter. Once you're
            scheduling work across departments or running a Kanban for
            leads, you've grown into Pro. Add AI when the drawing volume
            justifies it.
          </p>
          <Link
            href="/signup?plan=starter"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#D4956A] text-white font-medium rounded-xl hover:bg-[#C4855A] transition-colors"
          >
            Start with Starter <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-6 sm:py-8 px-5 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <MLogo size={16} color="white" />
            <span className="text-sm font-semibold text-white">MillSuite</span>
            <span className="text-xs text-[#555]">© 2026</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-[#555]">
            <a
              href="mailto:info@millsuite.com"
              className="hover:text-[#8B8B96] transition-colors"
            >
              info@millsuite.com
            </a>
            <Link href="/" className="hover:text-[#8B8B96] transition-colors">
              Home
            </Link>
            <Link
              href="/login"
              className="hover:text-[#8B8B96] transition-colors"
            >
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </>
  )
}
