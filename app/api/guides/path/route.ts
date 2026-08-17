import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { PathStatus } from '@/lib/walkthroughs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================================================
// /api/guides/path — has this shop actually done each step of the path?
// ============================================================================
// Completion is a FACT, never attendance. Nothing here looks at whether a tour
// was watched: an owner who set their rate book up alone has finished that step
// and must never be told to go do it. That also means the path can't drift out
// of sync with reality — delete the work and the step re-opens.
//
// Server-side because several checks need to join across tables the browser
// can't reach in one hop (estimate lines have no org_id; payments have no
// org_id), and because the spec asked for one round trip rather than eight
// queries fired from the page.
//
// Every check is independently fault-tolerant. A missing table on an older
// database answers "false" for its own gate instead of failing the request and
// blanking the whole page — `materials` only exists from 072, invoices from
// 041.
// ============================================================================

const FALSE_STATUS: PathStatus = {
  shop_setup: false,
  rate_book: false,
  first_job: false,
  sold_to_production: false,
  team_on_clock: false,
  getting_paid: false,
}

// Supabase reports a missing table as an error rather than throwing, so both
// paths have to be handled: a catch for genuine network failures, and a null
// `data` for "this database hasn't run that migration yet". Either way the
// answer is "no" for that one gate, never a failed request.
async function anyRow(q: PromiseLike<{ data: unknown }>): Promise<boolean> {
  try {
    const { data } = await q
    return Array.isArray(data) ? data.length > 0 : !!data
  } catch {
    return false
  }
}

async function firstRow<T>(q: PromiseLike<{ data: unknown }>): Promise<T | null> {
  try {
    const { data } = await q
    if (Array.isArray(data)) return (data[0] as T) ?? null
    return (data as T | null) ?? null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()
  const orgId = caller.orgId

  const [
    org,
    baseCabinet,
    anyMaterial,
    calibratedDoor,
    composedLine,
    productionProject,
    teamLogin,
    timeEntry,
    payment,
  ] = await Promise.all([
    firstRow<{ shop_rate: number | null }>(
      supabaseAdmin.from('orgs').select('shop_rate').eq('id', orgId).limit(1),
    ),
    // The composer finds the base cabinet by name (see lib/composer-loader),
    // so this asks the same question the pricing engine does.
    firstRow<Record<string, number | null>>(
      supabaseAdmin
        .from('rate_book_items')
        .select(
          'base_labor_hours_eng, base_labor_hours_cnc, base_labor_hours_assembly, base_labor_hours_finish',
        )
        .eq('org_id', orgId)
        .ilike('name', 'Base cabinet')
        .limit(1),
    ),
    // ANY active material, not carcass-flagged specifically (Andrew,
    // 2026-08-14): the rate-book guide teaches a door-veneer sheet as the
    // first material, and Browse-all reaches the whole catalog regardless of
    // quick-pick flags, so composing still works.
    anyRow(
      supabaseAdmin
        .from('materials')
        .select('id')
        .eq('org_id', orgId)
        .eq('active', true)
        .limit(1),
    ),
    anyRow(
      supabaseAdmin
        .from('door_types')
        .select('id')
        .eq('org_id', orgId)
        .eq('calibrated', true)
        .eq('active', true)
        .limit(1),
    ),
    // estimate_lines carries no org_id — it hangs off subprojects. !inner makes
    // the join filter actually filter; a plain embed returns every row and
    // merely nulls out the mismatches.
    anyRow(
      supabaseAdmin
        .from('estimate_lines')
        .select('id, subprojects!inner(org_id)')
        .eq('subprojects.org_id', orgId)
        .not('product_key', 'is', null)
        .limit(1),
    ),
    anyRow(
      supabaseAdmin
        .from('projects')
        .select('id')
        .eq('org_id', orgId)
        .in('stage', ['production', 'installed', 'complete'])
        .limit(1),
    ),
    // "A team login" means somebody OTHER than the owner. Counting all users
    // would mark this done for every org on day one, since the owner's own row
    // is created with the org.
    anyRow(
      supabaseAdmin.from('users').select('id').eq('org_id', orgId).neq('role', 'owner').limit(1),
    ),
    anyRow(supabaseAdmin.from('time_entries').select('id').eq('org_id', orgId).limit(1)),
    // Payments are the authoritative record (one row per payment) and also
    // carry no org_id, so they join up through the invoice.
    anyRow(
      supabaseAdmin
        .from('client_invoice_payments')
        .select('id, client_invoices!inner(org_id)')
        .eq('client_invoices.org_id', orgId)
        .limit(1),
    ),
  ])

  const baseCabinetHours = baseCabinet
    ? (Number(baseCabinet.base_labor_hours_eng) || 0) +
      (Number(baseCabinet.base_labor_hours_cnc) || 0) +
      (Number(baseCabinet.base_labor_hours_assembly) || 0) +
      (Number(baseCabinet.base_labor_hours_finish) || 0)
    : 0

  const hasShopRate = Number(org?.shop_rate) > 0
  const hasBaseCabinetLabor = baseCabinetHours > 0

  const status: PathStatus = {
    ...FALSE_STATUS,
    shop_setup: hasShopRate && hasBaseCabinetLabor,
    // Base cabinet labor is in the rate-book gate too, deliberately: the spec
    // lists all three, and it keeps step 2 honest if step 1's numbers are later
    // cleared.
    rate_book: anyMaterial && calibratedDoor && hasBaseCabinetLabor,
    first_job: composedLine,
    sold_to_production: productionProject,
    team_on_clock: teamLogin && timeEntry,
    getting_paid: payment,
  }

  return NextResponse.json(status)
}
