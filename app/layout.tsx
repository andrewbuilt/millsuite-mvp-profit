import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'

export const metadata: Metadata = {
  title: 'MillSuite — Project Profit Tracker',
  description: 'Know your numbers. Every project, every dollar.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MillSuite',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport = {
  themeColor: '#111111',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
