import Footer from '@/components/footer'
import TopNav from '@/components/top-nav'
import { ConfirmProvider } from '@/components/confirm-dialog'
import RoleGate from '@/components/role-gate'
import BillingGate from '@/components/billing-gate'
import WelcomeOverlay from '@/components/onboarding/WelcomeOverlay'
import UpdateBanner from '@/components/update-banner'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <RoleGate>
        {/* BillingGate sits between auth and content. plan_status='active'
            (or past_due, with a soft banner) passes through; pending /
            canceled / incomplete render a full-screen "complete payment"
            CTA so a customer who bails on Stripe Checkout can't reach
            the app without paying. */}
        <BillingGate>
          <div className="bg-[#F9FAFB] text-[#111] min-h-screen flex flex-col">
            <TopNav />
            <div className="flex-1">
              {children}
            </div>
            <Footer />
          </div>
          {/* First-login gate. Non-dismissible; unmounts when the current
              user's users.onboarded_at is non-null. Safe to render under
              RoleGate — the overlay hook reads useAuth() and renders
              nothing until the user + org are loaded. */}
          <WelcomeOverlay />
          {/* Gentle "new version available" toast — polls /api/version and
              nudges (never auto-reloads) when a newer deploy is live. */}
          <UpdateBanner />
        </BillingGate>
      </RoleGate>
    </ConfirmProvider>
  )
}
