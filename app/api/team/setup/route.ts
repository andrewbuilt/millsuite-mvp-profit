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

  // Roles for the org's real logins, keyed by users.id — the same id the
  // roster stores as team_members[].user_id. The /team account controls need
  // it to show whether a login is a manager or a worker (item 5). Roles
  // aren't sensitive the way comp is, so both owner and non-owner get them;
  // only the OWNER can change them (enforced in /api/admin/users).
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('org_id', caller.orgId)
  const roles = Object.fromEntries(
    (users || []).map((u) => [u.id as string, (u.role as string) || 'member']),
  )

  if (isOwner) {
    return NextResponse.json({ ...setup, roles, canSeeComp: true, callerRole: caller.role })
  }

  // Non-owner: strip every money figure. Keep names, hours, depts, contact,
  // active — what capacity + time-off need.
  return NextResponse.json({
    shopRate: 0,
    overhead: emptyOverheadInputs(),
    billable: setup.billable,
    team: setup.team.map((m) => ({ ...m, annual_comp: 0 })),
    roles,
    canSeeComp: false,
    callerRole: caller.role,
  })
}
