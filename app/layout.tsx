import type { Metadata } from 'next'
import './globals.css'
import Footer from '@/components/footer'

export const metadata: Metadata = {
  title: 'MillSuite — Project Profit Tracker',
  description: 'Know your numbers. Every project, every dollar.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#F9FAFB] text-[#111] antialiased min-h-screen flex flex-col">
        <div className="flex-1">
          {children}
        </div>
        <Footer />
      </body>
    </html>
  )
}
