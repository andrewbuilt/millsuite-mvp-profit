import Footer from '@/components/footer'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#F9FAFB] text-[#111] min-h-screen flex flex-col">
      <div className="flex-1">
        {children}
      </div>
      <Footer />
    </div>
  )
}
