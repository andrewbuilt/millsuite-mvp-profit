'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

interface AppUser {
  id: string
  org_id: string
  auth_user_id: string
  email: string
  name: string
  role: string
}

interface Org {
  id: string
  name: string
  slug: string
  shop_rate: number
  consumable_markup_pct: number
  profit_margin_pct: number
}

interface AuthContextType {
  user: AppUser | null
  org: Org | null
  authUser: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  org: null,
  authUser: null,
  loading: true,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [org, setOrg] = useState<Org | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  const publicPaths = ['/', '/pricing', '/login', '/signup']
  const isPublicPath = publicPaths.includes(pathname) || pathname.startsWith('/api')

  const loadUserData = useCallback(async (authId: string) => {
    const { data: userData } = await supabase
      .from('users')
      .select('id, org_id, auth_user_id, email, name, role')
      .eq('auth_user_id', authId)
      .single()

    if (userData) {
      setUser(userData)

      const { data: orgData } = await supabase
        .from('orgs')
        .select('id, name, slug, shop_rate, consumable_markup_pct, profit_margin_pct')
        .eq('id', userData.org_id)
        .single()

      if (orgData) setOrg(orgData)
    }
  }, [])

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setAuthUser(session.user)
        loadUserData(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setAuthUser(session.user)
        loadUserData(session.user.id)
      } else {
        setAuthUser(null)
        setUser(null)
        setOrg(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [loadUserData])

  // Redirect unauthenticated users away from app pages
  useEffect(() => {
    if (loading) return
    if (!authUser && !isPublicPath) {
      router.push('/login')
    }
  }, [authUser, loading, pathname, isPublicPath, router])

  async function signOut() {
    await supabase.auth.signOut()
    setAuthUser(null)
    setUser(null)
    setOrg(null)
    router.push('/')
  }

  return (
    <AuthContext.Provider value={{ user, org, authUser, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
