'use client'

// /{shop} — shop-branded manager/owner login → the full MillSuite app.
// e.g. millsuite.com/built. See components/shop-login.tsx.

import ShopLogin from '@/components/shop-login'

export default function ShopManagerLoginPage() {
  return <ShopLogin variant="manager" />
}
