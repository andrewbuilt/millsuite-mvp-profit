// lib/project-rollup.ts
// Recomputes ONE persisted total on a project:
//   actual_total = Σ time_entries.duration × the project's rate + Σ invoices.total_amount
//
// ⛔ IT NO LONGER TOUCHES bid_total (2026-10-21 shop-rate audit). It used to
// write bid_total = Σ subprojects.price — a column nothing has populated in a
// long time (0 on every row in prod) — and /time fires this on every timer
// stop and every manager edit, so stopping a timer set the job's price to $0
// until someone opened the project page and the page wrote it back. In
// between, the kanban, payments board, portal and /pm read $0. bid_total is
// owned by lib/project-totals alone. It also read `organizations.shop_rate`;
// that table doesn't exist (it's `orgs`), so labor was always $0.
//
// Called after subproject edits, time entry inserts, and invoice inserts.
// Uses supabaseAdmin so it can be invoked from server-side routes without
// juggling auth contexts, but is safe to invoke from client-authed code too
// because no user-scoped data is exposed.

import { supabaseAdmin } from '@/lib/supabase-admin'

export async function rollupProject(projectId: string): Promise<{
  bid_total: number
  actual_total: number
  actual_labor_cost: number
  actual_material_cost: number
} | null> {
  // Get project + org for the shop rate
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, org_id, bid_total, locked_shop_rate')
    .eq('id', projectId)
    .single()

  if (!project) return null

  const { data: org } = await supabaseAdmin
    .from('orgs')
    .select('shop_rate')
    .eq('id', project.org_id)
    .single()

  // The job's pinned rate, never the org's current one (118).
  const shopRate = Number(project.locked_shop_rate) || Number(org?.shop_rate) || 0

  // Load rollup inputs in parallel
  const [timeRes, invoicesRes] = await Promise.all([
    supabaseAdmin.from('time_entries').select('duration_minutes').eq('project_id', projectId),
    supabaseAdmin.from('invoices').select('total_amount').eq('project_id', projectId),
  ])

  const bidTotal = Number(project.bid_total) || 0
  const totalMinutes = (timeRes.data || []).reduce((sum, t: any) => sum + (Number(t.duration_minutes) || 0), 0)
  const actualLaborCost = (totalMinutes / 60) * shopRate
  const actualMaterialCost = (invoicesRes.data || []).reduce(
    (sum, i: any) => sum + (Number(i.total_amount) || 0),
    0
  )
  const actualTotal = actualLaborCost + actualMaterialCost

  await supabaseAdmin
    .from('projects')
    .update({ actual_total: round(actualTotal) })
    .eq('id', projectId)

  return {
    bid_total: round(bidTotal),
    actual_total: round(actualTotal),
    actual_labor_cost: round(actualLaborCost),
    actual_material_cost: round(actualMaterialCost),
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
