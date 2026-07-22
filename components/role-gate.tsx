'use client'

// RoleGate — role-based route guard.
//   - members (workers): confined to /me.
//   - admins: everything EXCEPT /settings (owner-only; comp lives there).
//   - owners: everything.
// Client-side only: the real protection is at the data layer.

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

// Routes members are allowed to see (any other /app route bounces to /me).
const MEMBER_ALLOWED_PREFIXES = ['/me']
const MEMBER_HOME = '/me'

export default function RoleGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (loading) return
    if (!user) return

    if (user.role === 'member') {
      const allowed = MEMBER_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))
      if (!allowed) router.replace(MEMBER_HOME)
      return
    }

    // Settings is owner-only (compensation lives there); bounce admins.
    if (user.role !== 'owner' && pathname.startsWith('/settings')) {
      router.replace('/dashboard')
    }
  }, [user, loading, pathname, router])

  return <>{children}</>
}
