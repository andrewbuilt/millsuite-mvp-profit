'use client'

// /{shop}/portal — shop-branded employee (time-tracking) login → /me.
// e.g. millsuite.com/built/portal. See components/shop-login.tsx.

import ShopLogin from '@/components/shop-login'

export default function ShopEmployeeLoginPage() {
  return <ShopLogin variant="employee" />
}
