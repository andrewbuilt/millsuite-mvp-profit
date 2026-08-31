// ============================================================================
// app/(portal)/layout.tsx — the client portal shell
// ============================================================================
// A route group, not a path segment: URLs stay /portal/{token}. This exists so
// the portal gets its own typography and background without inheriting the
// marketing dark theme or the app's TopNav/Footer chrome.
//
// The portal is the only surface a CLIENT ever sees, so it runs its own type
// system — Archivo + Courier Prime, per the design pass — rather than the app's
// DM Sans. Both are loaded here and nowhere else, so no other page pays for
// them.
// ============================================================================

import { Archivo, Courier_Prime } from 'next/font/google'

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-portal-sans',
  display: 'swap',
})

const courierPrime = Courier_Prime({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-portal-mono',
  display: 'swap',
})

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${archivo.variable} ${courierPrime.variable} min-h-screen bg-[#DEDAD2] text-[#161614]`}
      style={{ fontFamily: 'var(--font-portal-sans), Helvetica, Arial, sans-serif' }}
    >
      {children}
    </div>
  )
}
