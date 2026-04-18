import Footer from '@/components/footer'
import { ConfirmProvider } from '@/components/confirm-dialog'
import RoleGate from '@/components/role-gate'

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
      </RoleGate>
    </ConfirmProvider>
  )
}
