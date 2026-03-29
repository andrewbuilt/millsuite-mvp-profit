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
            Start Free Trial
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
            Start Free Trial
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
            Know if you're making money.{' '}
            <span className="text-[#8B8B96]">Before it's too late.</span>
          </h1>

          <p className="text-base sm:text-lg text-[#8B8B96] max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed">
            Most shop owners find out a job lost money when they're already on to the next one. MillSuite gives you real-time project profitability so you can fix problems before they eat your margin.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <Link href="/signup" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#D4956A] text-white font-medium rounded-xl hover:bg-[#C4855A] transition-colors">
              Start free for 14 days <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/pricing" className="w-full sm:w-auto text-center px-6 py-3 text-[#8B8B96] font-medium rounded-xl border border-white/[0.08] hover:border-white/[0.15] hover:text-white transition-colors">
              See pricing
            </Link>
          </div>

          <p className="text-xs text-[#555] mt-4">No credit card required. No sales call. Cancel anytime.</p>
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

      {/* PROBLEM → SOLUTION */}
      <section className="py-14 sm:py-20 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto">
          <div className="text-xs font-semibold text-[#D4956A] uppercase tracking-wider mb-4">The problem</div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">You're guessing. And it's costing you.</h2>
          <p className="text-[#8B8B96] mb-10 sm:mb-12 leading-relaxed">
            Every shop owner knows the feeling. You bid a job at $45,000. You think it went well.
            Then three months later you realize you spent $52,000 in labor and materials.
            By then it's too late — you've already cashed the check and moved on.
          </p>

          <div className="space-y-6 sm:space-y-8">
            <PainPoint
              number="1"
              problem="You don't know your real shop rate."
              solution="Most shops guess. MillSuite calculates it from your actual overhead, payroll, and production hours — so every bid starts from a real number, not a feeling."
            />
            <PainPoint
              number="2"
              problem="You can't see profit until the job is done."
              solution="MillSuite tracks labor hours and material costs in real time against your bid. You'll see the margin shrinking before it's gone — not after."
            />
            <PainPoint
              number="3"
              problem="Your estimates are based on the last job, not data."
              solution="Every completed project becomes data that makes your next estimate better. Over time, you're not guessing — you're pricing from your own track record."
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
            <FeatureCard icon={DollarSign} title="Shop Rate Calculator" description="Input your real overhead — rent, payroll, insurance, equipment. Get your true cost per production hour. Every bid starts from this number." />
            <FeatureCard icon={BarChart3} title="Real-Time Project P&L" description="See bid vs. actual cost on every project, updated live as hours are logged and invoices come in. Green means you're good. Red means fix it now." />
            <FeatureCard icon={Clock} title="Time Tracking" description="Start/stop timer or log hours manually. Time flows directly into project costs. Know exactly where every hour goes." />
            <FeatureCard icon={Receipt} title="Invoice Parsing" description="Upload a vendor invoice. AI extracts the line items. Assign to a project and the material cost updates automatically." />
            <FeatureCard icon={Users} title="Team Cost Tracking" description="Add your team with annual costs and billable status. Your shop rate adjusts to reflect who's actually producing vs. who's overhead." />
            <FeatureCard icon={Shield} title="Subproject Bidding" description="Break every job into subprojects — cabinets, countertops, install. Each gets its own material cost, labor hours, markup, and margin." />
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="py-14 sm:py-20 px-5 sm:px-6 border-t border-white/[0.04]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-xs font-semibold text-[#D4956A] uppercase tracking-wider mb-4">Built for shops like yours</div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Built inside a real shop.</h2>
          <p className="text-[#8B8B96] leading-relaxed mb-8">
            MillSuite was built inside Built LLC, a 14-person custom millwork shop in Tampa.
            We didn't read about the problems in a market research deck — we lived them.
            Every feature exists because we needed it ourselves.
          </p>
          <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="w-10 h-10 rounded-full bg-[#D4956A]/10 flex items-center justify-center">
              <span className="text-sm font-semibold text-[#D4956A]">AW</span>
            </div>
            <div className="text-left">
              <div className="text-sm font-medium text-white">Andrew Watson</div>
              <div className="text-xs text-[#8B8B96]">Founder, Built LLC & MillSuite</div>
            </div>
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
            <FAQItem question="What happens after the 14 days?" answer="You pick a plan or you walk away. We don't auto-charge anything. We don't believe in surprise bills." />
            <FAQItem question="Is there a contract?" answer="Nope. Month-to-month. Cancel whenever. We'd rather earn your business every month than lock you in." />
            <FAQItem question="What if my shop has 2 people? Or 15?" answer="The Starter plan works for shops of any size. As we release more advanced features — scheduling, capacity planning, AI estimating — we'll add plans that fit bigger operations." />
            <FAQItem question="We already use QuickBooks. Does this replace it?" answer="No, and we're not trying to. MillSuite tracks project profitability — what QuickBooks can't do well. They're complementary. QuickBooks integration is on our roadmap." />
            <FAQItem question="I've bought software before that nobody on my team ended up using." answer="Fair. Most shop software is built by people who've never run a shop. We built MillSuite inside a real millwork operation to solve problems we were living with. If your crew won't use it, that's our problem to fix." />
            <FAQItem question="Can I get a demo?" answer="You can — email us at info@millsuite.com. But honestly, just start the trial. It's faster, and you'll learn more in 10 minutes of using it than 30 minutes of watching someone else use it." />
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
            <Link href="/signup" className="inline-flex items-center gap-2 px-6 sm:px-8 py-3 sm:py-4 bg-[#D4956A] text-white text-base sm:text-lg font-medium rounded-xl hover:bg-[#C4855A] transition-colors">
              Start your free 14-day trial <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          <p className="text-sm text-[#555] mt-4">No credit card. No contract. No BS.</p>
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
