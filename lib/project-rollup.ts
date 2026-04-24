// lib/project-rollup.ts
// Recomputes the two persisted totals on a project:
//   bid_total    = Σ subprojects.price
//   actual_total = Σ time_entries.duration × org.shop_rate + Σ invoices.total_amount
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
    .select('id, org_id')
    .eq('id', projectId)
    .single()

  if (!project) return null

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('shop_rate')
    .eq('id', project.org_id)
    .single()

  const shopRate = org?.shop_rate ?? 0

  // Load rollup inputs in parallel
  const [subsRes, timeRes, invoicesRes] = await Promise.all([
    supabaseAdmin.from('subprojects').select('price').eq('project_id', projectId),
    supabaseAdmin.from('time_entries').select('duration_minutes').eq('project_id', projectId),
    supabaseAdmin.from('invoices').select('total_amount').eq('project_id', projectId),
  ])

  const bidTotal = (subsRes.data || []).reduce((sum, s: any) => sum + (Number(s.price) || 0), 0)
  const totalMinutes = (timeRes.data || []).reduce((sum, t: any) => sum + (Number(t.duration_minutes) || 0), 0)
  const actualLaborCost = (totalMinutes / 60) * shopRate
  const actualMaterialCost = (invoicesRes.data || []).reduce(
    (sum, i: any) => sum + (Number(i.total_amount) || 0),
    0
  )
  const actualTotal = actualLaborCost + actualMaterialCost

  await supabaseAdmin
    .from('projects')
    .update({
      bid_total: round(bidTotal),
      actual_total: round(actualTotal),
    })
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
