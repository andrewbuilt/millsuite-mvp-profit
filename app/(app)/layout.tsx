import Footer from '@/components/footer'
import { ConfirmProvider } from '@/components/confirm-dialog'
import RoleGate from '@/components/role-gate'
import WelcomeOverlay from '@/components/onboarding/WelcomeOverlay'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <RoleGate>
        <div className="bg-[#F9FAFB] text-[#111] min-h-screen flex flex-col">
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
      </RoleGate>
    </ConfirmProvider>
  )
}
