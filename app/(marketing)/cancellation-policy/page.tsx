import Link from 'next/link'
import { MLogo } from '@/components/logo'

// Cancellation policy — referenced from /pricing, /signup, the Customer
// Portal "return to" link, and the BillingGate full-screen prompt.
//
// Keep the policy stable. Edits here change what subscribers agreed to,
// so version any material change with a date stamp at the bottom.

export const metadata = {
  title: 'Cancellation Policy · MillSuite',
  description: 'How MillSuite subscriptions work, how to cancel, and what happens to your data afterward.',
}

export default function CancellationPolicyPage() {
  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]"
        style={{ background: 'rgba(13,13,15,0.8)', backdropFilter: 'blur(20px)' }}
      >
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
            <MLogo size={22} color="white" /> MillSuite
          </Link>
          <Link href="/pricing" className="text-sm text-[#8B8B96] hover:text-white transition-colors">
            Pricing
          </Link>
        </div>
      </nav>

      <div className="min-h-screen pt-32 pb-24 px-6">
        <article className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-2">Cancellation Policy</h1>
          <p className="text-sm text-[#8B8B96] mb-12">Last updated: May 3, 2026</p>

          <Section title="Subscription terms">
            MillSuite is a monthly subscription. You're billed each month on the same date you signed up.
            You can cancel at any time — there are no contracts, minimum commitments, or cancellation fees.
          </Section>

          <Section title="How to cancel">
            Open <strong className="text-white">Settings → Subscription</strong> in your MillSuite account
            and click <strong className="text-white">Manage subscription</strong>. That takes you to the
            Stripe-hosted billing portal where you can cancel with one click. You'll get an email confirmation
            from Stripe.
          </Section>

          <Section title="What happens when you cancel">
            Your cancellation takes effect at the end of your current billing period. That means:
            <ul className="list-disc pl-6 mt-3 space-y-2 text-[#B8B8C0]">
              <li>You keep full access to MillSuite through the day your current paid month ends.</li>
              <li>You will not be charged again.</li>
              <li>There are no refunds for partial months — you've already paid for the full month and you keep using it.</li>
              <li>You can resubscribe at any time. Your data stays intact (see "Data after cancellation" below).</li>
            </ul>
          </Section>

          <Section title="Data after cancellation">
            We retain your shop data — projects, estimates, schedule, invoices, time entries, settings — for{' '}
            <strong className="text-white">30 days</strong> after cancellation. Within that window, you can
            resubscribe and pick up exactly where you left off, or contact{' '}
            <a className="text-[#D4956A] hover:underline" href="mailto:support@millsuite.com">
              support@millsuite.com
            </a>{' '}
            to request a CSV export of your data. After 30 days, your data is permanently deleted from our
            production database.
          </Section>

          <Section title="Failed payments">
            If a recurring payment fails (expired card, insufficient funds, etc.), Stripe will retry the
            charge over the following days and we'll email you. Your account stays active during this
            window. If the dunning cycle exhausts without a successful retry, your subscription is
            canceled — you'll see the same 30-day data retention as a manual cancellation.
          </Section>

          <Section title="Refunds">
            Because cancellations take effect at period end and you keep using the service through that
            date, we don't issue prorated refunds. If you believe you've been charged in error or want to
            discuss a specific situation, email{' '}
            <a className="text-[#D4956A] hover:underline" href="mailto:support@millsuite.com">
              support@millsuite.com
            </a>{' '}
            and we'll work it out.
          </Section>

          <Section title="Changing plans or seats">
            You can change tiers (Starter / Pro / Pro+AI) or add/remove seats from the same Customer
            Portal. Plan changes are prorated automatically by Stripe — you're credited for the unused
            portion of your current plan and charged for the new plan from that day forward.
          </Section>

          <Section title="Questions">
            Email{' '}
            <a className="text-[#D4956A] hover:underline" href="mailto:support@millsuite.com">
              support@millsuite.com
            </a>{' '}
            for anything else.
          </Section>

          <div className="mt-16 pt-8 border-t border-white/[0.08] flex items-center justify-between text-sm">
            <Link href="/pricing" className="text-[#8B8B96] hover:text-white transition-colors">
              ← Back to pricing
            </Link>
            <Link href="/signup?plan=pro-ai" className="text-[#D4956A] hover:text-[#C4855A] transition-colors">
              Start a subscription →
            </Link>
          </div>
        </article>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <div className="text-sm text-[#B8B8C0] leading-relaxed">{children}</div>
    </section>
  )
}
