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
  plan: string
  // Subscription state — populated by the stripe-webhook. Existing rows
  // pre-billing landed at plan_status='active' via the migration default
  // so they don't get gated; new signups land at 'pending' until Stripe
  // confirms payment.
  plan_status: string
  seats: number
  current_period_end: string | null
  cancel_at_period_end: boolean
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  pending_checkout_session_id: string | null
  shop_rate: number
  consumable_markup_pct: number
  profit_margin_pct: number
  // Per-bucket margin defaults (migration 052). NULL = fall back to 35 in
  // code. profit_margin_pct stays as a legacy fallback for any read path
  // not yet migrated to the three knobs.
  labor_margin_pct: number | null
  material_margin_pct: number | null
  consumable_margin_pct: number | null
  // Set by the stripe-webhook when a seat downgrade is blocked because
  // active users exceed the new seat count (L1). Drives the Settings →
  // Billing "finish your downgrade" banner. NULL = nothing pending.
  pending_seat_downgrade: number | null
  // End of the no-card base-tier trial (055). NULL = not on a trial.
  // plan_status='trialing' grants access until this timestamp.
  trial_ends_at: string | null
  // Invoicing backend (057): 'internal' = MillSuite's built-in invoices
  // (default); 'quickbooks' = push estimates/invoices to QB. Read via
  // invoicingMode(org) from lib/org-settings.
  invoicing_mode: string
}

const ORG_SELECT =
  'id, name, slug, plan, plan_status, seats, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, pending_checkout_session_id, shop_rate, consumable_markup_pct, profit_margin_pct, labor_margin_pct, material_margin_pct, consumable_margin_pct, pending_seat_downgrade, trial_ends_at, business_address, business_city, business_state, business_zip, business_phone, business_email, invoicing_mode'

interface AuthContextType {
  user: AppUser | null
  org: Org | null
  authUser: User | null
  loading: boolean
  signOut: () => Promise<void>
  refreshOrg: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  org: null,
  authUser: null,
  loading: true,
  signOut: async () => {},
  refreshOrg: async () => {},
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

  const publicPaths = ['/', '/pricing', '/login', '/signup', '/cancellation-policy']
  // Real top-level app/marketing routes. Any OTHER first segment is treated
  // as an org slug — the shop-branded login pages (/{shop} + /{shop}/portal),
  // which are public so a logged-out manager/worker can sign in there.
  const RESERVED_TOP_LEVEL = new Set([
    'api', 'join', 'login', 'signup', 'pricing', 'cancellation-policy',
    'capacity', 'change-orders', 'clients', 'dashboard', 'estimates', 'invoices', 'me', 'projects',
    'qb-reconciliation', 'rate-book', 'reports', 'sales', 'schedule',
    'settings', 'suggestions', 'team', 'time',
  ])
  const firstSegment = pathname.split('/')[1] || ''
  const isShopLoginPath = firstSegment !== '' && !RESERVED_TOP_LEVEL.has(firstSegment)
  const isPublicPath =
    publicPaths.includes(pathname) ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/join') ||
    isShopLoginPath

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
        .select(ORG_SELECT)
        .eq('id', userData.org_id)
        .single()

      if (orgData) setOrg(orgData)
    }
  }, [])

  useEffect(() => {
    // The user id we've already loaded data for. Supabase fires
    // onAuthStateChange (TOKEN_REFRESHED / SIGNED_IN) every time the tab
    // regains focus and the token is refreshed; without this guard we'd
    // re-setAuthUser + re-fetch user/org on every focus, churning the context
    // value and making every page look like it reloaded. We only react when
    // the *user* actually changes (real sign-in / sign-out).
    const loadedUserId = { current: null as string | null }

    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadedUserId.current = session.user.id
        setAuthUser(session.user)
        loadUserData(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      if (nextUser) {
        // Same user (e.g. token refresh on tab focus) — don't churn state.
        if (loadedUserId.current === nextUser.id) return
        loadedUserId.current = nextUser.id
        setAuthUser(nextUser)
        loadUserData(nextUser.id)
      } else {
        loadedUserId.current = null
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

  async function refreshOrg() {
    if (!user?.org_id) return
    const { data: orgData } = await supabase
      .from('orgs')
      .select(ORG_SELECT)
      .eq('id', user.org_id)
      .single()
    if (orgData) setOrg(orgData)
  }

  async function signOut() {
    await supabase.auth.signOut()
    setAuthUser(null)
    setUser(null)
    setOrg(null)
    router.push('/')
  }

  return (
    <AuthContext.Provider value={{ user, org, authUser, loading, signOut, refreshOrg }}>
      {children}
    </AuthContext.Provider>
  )
}
