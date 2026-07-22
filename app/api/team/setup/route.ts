import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadShopRateSetup, emptyOverheadInputs } from '@/lib/shop-rate-setup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Team + shop-rate setup for the /team page. Compensation (per-member
// annual_comp, total payroll, the derived shop rate + overhead) is OWNER-ONLY —
// for admins/managers it's stripped server-side so comp never ships to a
// non-owner client. Everyone gets the roster hours/depts (capacity + PTO math).
export async function GET(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()

  const setup = await loadShopRateSetup(caller.orgId, supabaseAdmin)
  const isOwner = caller.role === 'owner'

  if (isOwner) {
    return NextResponse.json({ ...setup, canSeeComp: true })
  }

  // Non-owner: strip every money figure. Keep names, hours, depts, contact,
  // active — what capacity + time-off need.
  return NextResponse.json({
    shopRate: 0,
    overhead: emptyOverheadInputs(),
    billable: setup.billable,
    team: setup.team.map((m) => ({ ...m, annual_comp: 0 })),
    canSeeComp: false,
  })
}
