import Footer from '@/components/footer'
import { ConfirmProvider } from '@/components/confirm-dialog'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <div className="bg-[#F9FAFB] text-[#111] min-h-screen flex flex-col">
        <div className="flex-1">
          {children}
        </div>
        <Footer />
      </div>
    </ConfirmProvider>
  )
}
