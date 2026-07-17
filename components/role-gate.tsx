'use client'

// RoleGate — keeps member-role users (workers) inside the worker app.
// Owners/admins see everything; members only ever belong on /me (the phone
// worker app). Client-side only: the real protection is at the data layer.

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
    if (user.role !== 'member') return

    const allowed = MEMBER_ALLOWED_PREFIXES.some(p => pathname.startsWith(p))
    if (!allowed) {
      router.replace(MEMBER_HOME)
    }
  }, [user, loading, pathname, router])

  return <>{children}</>
}
