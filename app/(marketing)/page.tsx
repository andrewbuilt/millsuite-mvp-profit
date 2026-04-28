'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, Clock, DollarSign, BarChart3, Receipt, Users, Shield, Menu, X } from 'lucide-react'
import { MLogo } from '@/components/logo'

// ── Nav ──

function MarketingNav() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]" style={{ background: 'rgba(13,13,15,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
      <div className="max-w-6xl mx-auto px-5 sm:px-6 flex items-center justify-between h-14 sm:h-16">
        <Link href="/" className="flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight text-white">
          <MLogo size={20} color="white" />
          MillSuite
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-6">
          <Link href="/pricing" className="text-sm text-[#8B8B96] hover:text-white transition-colors">Pricing</Link>
          <Link href="/login" className="text-sm text-[#8B8B96] hover:text-white transition-colors">Log in</Link>
          <Link href="/signup" className="px-4 py-2 bg-[#D4956A] text-white text-sm font-medium rounded-lg hover:bg-[#C4855A] transition-colors">
            Sign up
          </Link>
        </div>

        {/* Mobile menu button */}
        <button onClick={() => setMenuOpen(!menuOpen)} className="sm:hidden p-2 text-white/60">
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="sm:hidden border-t border-white/[0.06] px-5 py-4 space-y-3" style={{ background: 'rgba(13,13,15,0.95)' }}>
          <Link href="/pricing" onClick={() => setMenuOpen(false)} className="block text-sm text-[#8B8B96] py-2">Pricing</Link>
          <Link href="/login" onClick={() => setMenuOpen(false)} className="block text-sm text-[#8B8B96] py-2">Log in</Link>
          <Link href="/signup" onClick={() => setMenuOpen(false)} className="block w-full text-center px-4 py-2.5 bg-[#D4956A] text-white text-sm font-medium rounded-lg">
            Sign up
          </Link>
        </div>
      )}
    </nav>
  )
}

// ── Feature Card ──

function FeatureCard({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="p-5 sm:p-6 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
      <div className="w-10 h-10 rounded-xl bg-[#D4956A]/10 flex items-center justify-center mb-4">
        <Icon className="w-5 h-5 text-[#D4956A]" />
      </div>
      <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-[#8B8B96] leading-relaxed">{description}</p>
    </div>
  )
}

// ── Pain Point ──

function PainPoint({ number, problem, solution }: { number: string; problem: string; solution: string }) {
  return (
    <div className="flex gap-4 sm:gap-6">
      <div className="w-8 h-8 rounded-full bg-[#D4956A]/10 border border-[#D4956A]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-xs font-semibold text-[#D4956A]">{number}</span>
      </div>
      <div>
        <p className="text-white font-medium mb-1">{problem}</p>
        <p className="text-sm text-[#8B8B96] leading-relaxed">{solution}</p>
      </div>
    </div>
  )
}

// ── FAQ Item ──

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="py-5 sm:py-6 border-b border-white/[0.06]">
      <h4 className="text-base font-medium text-white mb-2">{question}</h4>
      <p className="text-sm text-[#8B8B96] leading-relaxed">{answer}</p>
    </div>
  )
}

// ── Page ──

export default function LandingPage() {
  return (
    <>
      <MarketingNav />

      {/* HERO */}
      <section className="pt-24 sm:pt-32 pb-12 sm:pb-20 px-5 sm:px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#D4956A]/20 bg-[#D4956A]/5 mb-6 sm:mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D4956A]" />
            <span className="text-xs font-medium text-[#D4956A]">Now in early access</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1] mb-5 sm:mb-6">
            More sales won't save your shop.{' '}
            <span className="text-[#8B8B96]">Knowing your numbers will.</span>
          </h1>

          <p className="text-base sm:text-lg text-[#8B8B96] max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed">
            Most shop owners don't know if a job made money until it's too late to do anything about it.
            MillSuite tracks your actual costs against your bid, in real time, so you can catch problems before they eat your margin.
            Built by a shop owner who spent 14 years figuring this out the hard way.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <Link href="/pricing" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#D4956A] text-white font-medium rounded-xl hover:bg-[#C4855A] transition-colors">
              See pricing <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="https://tools.millsuite.com" className="w-full sm:w-auto text-center px-6 py-3 text-[#8B8B96] font-medium rounded-xl border border-white/[0.08] hover:border-white/[0.15] hover:text-white transition-colors">
              Calculate your shop rate (free)
            </a>
          </div>

          <p className="text-xs text-[#555] mt-4">Per seat. Three tiers. No sales call.</p>
        </div>

        {/* Product UI Preview */}
        <div className="max-w-5xl mx-auto mt-10 sm:mt-16">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-1 overflow-hidden">
            <div className="rounded-xl bg-[#F9FAFB] p-4 sm:p-6 text-[#111]">
              {/* Browser dots */}
              <div className="hidden sm:flex items-center gap-3 mb-6">
                <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
                <span className="text-xs text-[#9CA3AF] ml-2">millsuite.com/dashboard</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-3 sm:mb-4">
                {[
                  { label: 'Shop Rate', value: '$87.50/hr', color: 'text-[#2563EB]' },
                  { label: 'In Production', value: '6', sub: '$284,200 bid value' },
                  { label: 'Bidding', value: '3', sub: '$142,000 pipeline' },
                  { label: 'Margin', value: '+32.4%', color: 'text-[#059669]' },
                ].map(m => (
                  <div key={m.label} className="bg-white border border-[#E5E7EB] rounded-xl p-3 sm:p-4">
                    <div className="text-[9px] sm:text-[10px] text-[#9CA3AF] uppercase tracking-wider mb-1">{m.label}</div>
                    <div className={`text-lg sm:text-xl font-mono tabular-nums font-semibold ${m.color || 'text-[#111]'}`}>{m.value}</div>
                    {m.sub && <div className="text-[9px] sm:text-[10px] text-[#9CA3AF] mt-0.5 hidden sm:block">{m.sub}</div>}
                  </div>
                ))}
              </div>
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-2 sm:mb-3">
                  <div className="w-2 h-2 rounded-full bg-[#059669]" />
                  <span className="text-xs font-medium">All projects on track</span>
                </div>
                <div className="text-[10px] text-[#9CA3AF]">No active projects are trending over budget</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOUNDER CREDIBILITY + LEARNING LOOP */}
      <section className="py-14 sm:py-20 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto">
          <div className="text-xs font-semibold text-[#D4956A] uppercase tracking-wider mb-4 text-center">Built by a shop owner</div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4 text-center">
            14 years running a millwork shop. Over $10M of real projects through the system.
          </h2>
          <p className="text-[#8B8B96] mb-6 leading-relaxed text-center">
            I'm Andrew Watson. I run Built LLC, a 14-person custom millwork shop in Tampa.
            I tried spreadsheets, I tried enterprise software, I tried stitching together 4 different tools.
            None of it could answer the one question that matters: am I making money on this job?
          </p>
          <p className="text-[#8B8B96] mb-6 leading-relaxed text-center">
            So I built the answer. I ran over $10M of my own projects through MillSuite to build and prove the pricing engine.
          </p>

          {/* Learning Loop */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8 mt-8">
            <h3 className="text-lg font-semibold text-white mb-3 text-center">Now every shop trains its own version.</h3>
            <p className="text-sm text-[#8B8B96] leading-relaxed text-center mb-6">
              MillSuite isn't a pre-trained AI that already knows your prices. It's a system that learns YOUR shop from YOUR data.
              Every job you estimate, track costs on, and complete teaches the system what works in your specific business.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              {[
                { step: '1', label: 'Estimate a job' },
                { step: '2', label: 'Track your actual costs' },
                { step: '3', label: 'Complete the project' },
                { step: '4', label: 'Your system gets smarter' },
              ].map(s => (
                <div key={s.step} className="text-center p-3 rounded-xl bg-white/[0.03]">
                  <div className="text-lg font-bold text-[#D4956A] mb-1">{s.step}</div>
                  <div className="text-xs text-[#8B8B96]">{s.label}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-[#555] text-center mt-4">Step by step. Job by job. The more you use it, the smarter it gets for your shop.</p>
          </div>
        </div>
      </section>

      {/* PROBLEM → SOLUTION */}
      <section className="py-14 sm:py-20 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto">
          <div className="text-xs font-semibold text-[#D4956A] uppercase tracking-wider mb-4">The problem</div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">You're guessing. And it's costing you.</h2>
          <p className="text-[#8B8B96] mb-10 sm:mb-12 leading-relaxed">
            Every shop owner knows the feeling. You bid a job at $45,000. You think it went well.
            Then three months later you realize you spent $52,000 in labor and materials.
            By then it's too late. You've already moved on to the next one. The loss just quietly drains your account.
          </p>

          <div className="space-y-6 sm:space-y-8">
            <PainPoint
              number="1"
              problem="You don't know your real shop rate."
              solution="You're pricing jobs based on a number you made up years ago. If that number is wrong, every bid you send is wrong too. MillSuite calculates it from your actual overhead, payroll, and production hours."
            />
            <PainPoint
              number="2"
              problem="You don't know if a job's losing money until it's already done."
              solution="MillSuite tracks labor hours and material costs in real time against your bid. You see the margin moving before it's gone, not after."
            />
            <PainPoint
              number="3"
              problem="Your estimates don't get better over time."
              solution="Every bid is a guess disconnected from the last one. With MillSuite, every completed project teaches your system to estimate the next one more accurately. Your pricing gets smarter with every job."
            />
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="py-14 sm:py-20 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 sm:mb-12">
            <div className="text-xs font-semibold text-[#D4956A] uppercase tracking-wider mb-4">What you get</div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Everything you need to protect your margin.</h2>
            <p className="text-[#8B8B96] max-w-2xl mx-auto">Not 200 features you'll never use. Just the ones that tell you if you're making money.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <FeatureCard icon={BarChart3} title="Real-Time Project P&L" description="See if a job's making or losing money, right now. Costs update live as hours are logged and invoices come in. No more finding out you lost money three weeks after the install." />
            <FeatureCard icon={DollarSign} title="Shop Rate Calculator" description="Input your real overhead. Get your true cost per production hour. Every bid starts from a real number, not a feeling. Free to use at tools.millsuite.com." />
            <FeatureCard icon={Clock} title="Time Tracking" description="Open the app, pick your project, tap start. Tap stop when you're done. That's the whole thing. Hours flow directly into project costs automatically." />
            <FeatureCard icon={Receipt} title="Invoice Parsing" description="Snap a photo of a vendor invoice. AI reads every line item, matches it to your project. Costs update in real time across all active jobs." />
            <FeatureCard icon={Users} title="Team Cost Tracking" description="Add your team with annual costs and billable status. Your shop rate adjusts to reflect who's actually producing vs. who's overhead." />
            <FeatureCard icon={Shield} title="Subproject Bidding" description="Break every job into subprojects. Cabinets, countertops, install. Each gets its own material cost, labor hours, markup, and margin. Set your target margin and see instantly if you're hitting it." />
          </div>
        </div>
      </section>

      {/* BY THE NUMBERS */}
      <section className="py-14 sm:py-20 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-4xl mx-auto">
          <div className="text-xs font-semibold text-[#D4956A] uppercase tracking-wider mb-4 text-center">By the numbers</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
            {[
              { stat: '14', label: 'years running a shop' },
              { stat: '$10M+', label: 'of real projects through the system' },
              { stat: '1', label: 'system to replace them all' },
              { stat: '<1hr', label: 'to get up and running' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-3xl sm:text-4xl font-bold font-mono text-white mb-1">{s.stat}</div>
                <div className="text-xs text-[#8B8B96]">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-14 sm:py-20 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Honest answers.</h2>
            <p className="text-[#8B8B96]">To the questions you're probably already thinking.</p>
          </div>

          <div>
            <FAQItem question="Is there a contract?" answer="Nope. Month-to-month. Cancel whenever. We'd rather earn your business every month than lock you in." />
            <FAQItem question="What if my data isn't perfect?" answer="It doesn't need to be. Perfect data isn't the goal. Directional data that gets better every project is. Track what you can. The system learns from whatever you give it. Every job you track makes the next estimate better." />
            <FAQItem question="My shop is different from everyone else's." answer="We've talked to shops from $1M to $50M in revenue. Custom millwork, commercial interiors, residential cabinets. They all have the same core problem: they don't know which jobs make money. The work is unique. The problem isn't. And because MillSuite learns from YOUR projects, it adapts to your specific shop." />
            <FAQItem question="My guys won't track their time." answer="We built the time tracker for shop floor guys, not accountants. Open the app, pick your project, tap start. Tap stop when you're done. That's the whole thing." />
            <FAQItem question="What if MillSuite goes away? You're a small company." answer="Fair question. Your data is yours and you can export it anytime. But also: I've been running a millwork shop for 14 years. I built this software because I need it to run my own business. It's not going anywhere." />
            <FAQItem question="We already use QuickBooks. Does this replace it?" answer="No, and we're not trying to. MillSuite tracks project profitability, which is what QuickBooks can't do well. They're complementary. QuickBooks integration is on our roadmap." />
            <FAQItem question="I've bought software before that nobody ended up using." answer="Most shop software is built by people who've never run a shop. We built MillSuite inside a real millwork operation to solve problems we were living with every day. If your crew won't use it, that's our problem to fix." />
            <FAQItem question="Can I get a demo?" answer="You can. Email us at info@millsuite.com. But honestly, just sign up for Starter — it's faster, and you'll learn more in 10 minutes of using it than 30 minutes of watching someone else use it." />
          </div>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section className="py-16 sm:py-24 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-4">
            Your next job is already in progress.{' '}
            <span className="text-[#8B8B96]">Do you know if it's making money?</span>
          </h2>
          <div className="mt-8">
            <Link href="/pricing" className="inline-flex items-center gap-2 px-6 sm:px-8 py-3 sm:py-4 bg-[#D4956A] text-white text-base sm:text-lg font-medium rounded-xl hover:bg-[#C4855A] transition-colors">
              See pricing <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          <p className="text-sm text-[#8B8B96] mt-4">Join the shop owners who stopped guessing and started knowing.</p>
          <p className="text-xs text-[#555] mt-2">Per seat. Three tiers. No BS.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/[0.06] py-6 sm:py-8 px-5 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <MLogo size={16} color="white" />
            <span className="text-sm font-semibold text-white">MillSuite</span>
            <span className="text-xs text-[#555]">© 2026</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-[#555]">
            <a href="mailto:info@millsuite.com" className="hover:text-[#8B8B96] transition-colors">info@millsuite.com</a>
            <Link href="/pricing" className="hover:text-[#8B8B96] transition-colors">Pricing</Link>
            <Link href="/login" className="hover:text-[#8B8B96] transition-colors">Log in</Link>
          </div>
        </div>
      </footer>
    </>
  )
}
