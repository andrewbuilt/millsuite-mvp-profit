// lib/leads.ts
// Lead CRUD + convertLeadToProject. Pro-tier only (feature-flagged at route level).
//
// Adapted from Built OS for MVP's simpler schema:
//   - Projects use `name` (not project_name)
//   - Subprojects use `sort_order` (not sequence_order)
//   - Status model is Option A: status='active' + production_phase='pre_production' on convert
//   - Cash flow table is `cash_flow_receivables` (not `cash_flow`)
//   - No Klaviyo email yet (stub, wire later)

import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { firePortalStepEmail } from '@/lib/portal'
import type {
  Lead,
  LeadStatus,
  LeadSubproject,
  PaymentTerms,
  Project,
} from '@/lib/types'

// ===========================
// Lead CRUD
// ===========================

export async function getLeads(orgId: string) {
  const { data, error } = await supabase
    .from('leads')
    .select(
      `
      *,
      client:clients(id, name),
      contact:contacts(id, name, email, phone),
      lead_subprojects(id, name, estimated_price, estimated_hours, material_cost, sequence_order)
    `
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as unknown as Lead[]
}

export async function getLead(id: string) {
  const { data, error } = await supabase
    .from('leads')
    .select(
      `
      *,
      client:clients(*),
      contact:contacts(*),
      lead_subprojects(*)
    `
    )
    .eq('id', id)
    .single()

  if (error) throw error
  if (!data) throw new Error('Lead not found')
  return data as Lead
}

export async function createLead(leadData: Partial<Lead>) {
  const { data, error } = await supabase
    .from('leads')
    .insert(leadData)
    .select()
    .single()
  if (error) throw error
  if (!data) throw new Error('Failed to create lead')
  return data as Lead
}

export async function updateLead(id: string, updates: Partial<Lead>) {
  const { data, error } = await supabase
    .from('leads')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  if (!data) throw new Error('Failed to update lead')
  return data as Lead
}

export async function updateLeadStatus(id: string, status: LeadStatus) {
  return updateLead(id, { status })
}

export async function deleteLead(id: string) {
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw error
}

// ===========================
// Lead subproject CRUD
// ===========================

export async function createLeadSubproject(data: Partial<LeadSubproject>) {
  const { data: row, error } = await supabase
    .from('lead_subprojects')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return row as LeadSubproject
}

export async function updateLeadSubproject(id: string, updates: Partial<LeadSubproject>) {
  const { data, error } = await supabase
    .from('lead_subprojects')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as LeadSubproject
}

export async function deleteLeadSubproject(id: string) {
  const { error } = await supabase.from('lead_subprojects').delete().eq('id', id)
  if (error) throw error
}

// ===========================
// convertLeadToProject (the big one)
// ===========================
//
// Port of Built OS convertLeadToProject. Runs when a lead is dragged to "Sold".
// 1. Create project (status='active', production_phase='pre_production')
// 2. Copy lead_subprojects → subprojects with all v2/v3 fields
// 3. Explode dept_hours JSONB → department_allocations rows
// 4. Seed selections from specs_json OR create 4 default empty selections
// 5. Generate cash_flow_receivables from payment_terms.milestones
// 6. Setup client portal (slug + password)
// 7. Mark lead as converted + copy comments

// Uses the service-role admin client so the cross-table writes (projects,
// subprojects, department_allocations, selections, cash_flow_receivables,
// portal_timeline, comments) all succeed regardless of RLS policy.
// Call this only from a server-side context (API route) that has validated
// the user is authorized to convert this lead.

export async function convertLeadToProject(leadId: string): Promise<Project> {
  const db = supabaseAdmin

  const { data: lead, error: leadError } = await db
    .from('leads')
    .select(`*, client:clients(*), contact:contacts(*), lead_subprojects(*)`)
    .eq('id', leadId)
    .single()

  if (leadError) throw leadError
  if (!lead) throw new Error('Lead not found')

  // Snapshot current shop rate at time of sale
  const { data: latestSnapshot } = await db
    .from('shop_rate_snapshots')
    .select('effective_rate')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // 1. Create project
  const projectData: Record<string, any> = {
    org_id: lead.org_id,
    name: lead.lead_name,
    client_id: lead.client_id,
    contact_id: lead.contact_id,
    client_name: lead.client_name || lead.client?.name || null,
    status: 'active',
    production_phase: 'pre_production',
    estimated_price: lead.estimated_price,
    estimated_hours: lead.estimated_hours,
    bid_total: lead.estimated_price || 0,
    delivery_address: lead.delivery_address,
    source_lead_id: leadId,
    locked_shop_rate: latestSnapshot?.effective_rate || null,
    drive_folder_id: lead.drive_folder_id || null,
    drive_folder_url: lead.drive_folder_url || null,
    payment_terms: lead.payment_terms || null,
    sold_at: new Date().toISOString(),
  }

  const { data: project, error: projectError } = await db
    .from('projects')
    .insert(projectData)
    .select()
    .single()

  if (projectError) throw projectError
  if (!project) throw new Error('Failed to create project')

  // 2. Department name → ID lookup for dept_hours mapping
  const { data: departments } = await db.from('departments').select('id, name')
  const deptMap = new Map<string, string>()
  for (const dept of departments || []) {
    deptMap.set(dept.name.toLowerCase(), dept.id)
  }

  // 3. Copy lead_subprojects → subprojects
  const { data: fullLeadSubs } = await db
    .from('lead_subprojects')
    .select('*')
    .eq('lead_id', leadId)
    .order('sequence_order')

  for (const ls of fullLeadSubs || []) {
    const subInsert: Record<string, any> = {
      project_id: project.id,
      org_id: lead.org_id,
      name: ls.name,
      sort_order: ls.sequence_order, // MVP uses sort_order, not sequence_order
      description: ls.description,
      estimated_hours: ls.estimated_hours || 0,
      estimated_price: ls.estimated_price || 0,
      original_estimated_hours: ls.estimated_hours || 0,
      original_estimated_price: ls.estimated_price || 0,
      linear_feet: ls.linear_feet,
      quality_type: ls.quality_type,
      rate_per_lf: ls.rate_per_lf,
      hours_per_lf: ls.hours_per_lf,
      material_cost: ls.material_cost,
      material_finish: ls.material_finish,
      activity_type: ls.activity_type,
      dimensions: ls.dimensions,
      details_json: ls.details_json,
      exclusions_json: ls.exclusions_json,
      pricing_lines_json: ls.pricing_lines_json,
      dept_hours: ls.dept_hours,
      specs_json: ls.specs_json,
      spec_lines_json: ls.spec_lines_json,
      assembly_lines_json: ls.assembly_lines_json,
      drive_folder_id: ls.drive_folder_id,
      drive_approval_folder_id: ls.drive_approval_folder_id,
      // Starter-level mirrors: keep labor_hours and price in sync so Starter UI still works
      labor_hours: ls.estimated_hours || 0,
      price: ls.estimated_price || 0,
    }

    const { data: newSub, error: subError } = await db
      .from('subprojects')
      .insert(subInsert)
      .select()
      .single()

    if (subError || !newSub) {
      console.error('Error creating subproject:', subError, subInsert)
      continue
    }

    // 3a. department_allocations from dept_hours JSONB
    const deptHours = ls.dept_hours as Record<string, number> | null
    if (deptHours && typeof deptHours === 'object') {
      const allocations: any[] = []
      let seq = 1
      for (const [deptKey, hours] of Object.entries(deptHours)) {
        if (typeof hours !== 'number' || hours <= 0) continue
        const departmentId = deptMap.get(deptKey.toLowerCase())
        if (!departmentId) {
          console.warn(`No department found for key: ${deptKey}`)
          continue
        }
        allocations.push({
          subproject_id: newSub.id,
          department_id: departmentId,
          name: deptKey.charAt(0).toUpperCase() + deptKey.slice(1),
          estimated_hours: Math.round(hours),
          sequence_order: seq++,
          completed: false,
          actual_hours: 0,
        })
      }
      if (allocations.length > 0) {
        const { error: allocError } = await db
          .from('department_allocations')
          .insert(allocations)
        if (allocError) console.error('Error creating dept allocations:', allocError)
      }
    }

    // 3b. Seed selections from specs_json, or create 4 defaults
    const specsJson = ls.specs_json as any[] | null
    if (specsJson && Array.isArray(specsJson) && specsJson.length > 0) {
      const selections = specsJson
        .filter((spec: any) => spec.category && spec.category !== 'custom')
        .map((spec: any, idx: number) => ({
          project_id: project.id,
          subproject_id: newSub.id,
          category: spec.category,
          label:
            spec.label?.split(':')[0]?.trim() ||
            spec.category
              .replace(/_/g, ' ')
              .replace(/\b\w/g, (c: string) => c.toUpperCase()),
          spec_value: spec.finish || null,
          status: spec.finish ? 'pending_review' : 'unconfirmed',
          display_order: spec.sequence_order || idx + 1,
        }))
      if (selections.length > 0) {
        const { error } = await db.from('selections').insert(selections)
        if (error) console.error('Error seeding selections:', error)
      }
    } else {
      const defaults = [
        { category: 'cabinet_exterior', label: 'Cabinet Exterior', display_order: 1 },
        { category: 'cabinet_interior', label: 'Cabinet Interior', display_order: 2 },
        { category: 'drawer', label: 'Drawer Type', display_order: 3 },
        { category: 'hardware', label: 'Hardware', display_order: 4 },
      ].map(d => ({
        ...d,
        project_id: project.id,
        subproject_id: newSub.id,
        status: 'unconfirmed' as const,
      }))
      const { error } = await db.from('selections').insert(defaults)
      if (error) console.error('Error creating default selections:', error)
    }
  }

  // 4. Generate cash_flow_receivables from payment_terms
  try {
    const paymentTerms = lead.payment_terms as PaymentTerms | null
    const totalPrice = project.estimated_price || 0

    if (paymentTerms?.milestones && paymentTerms.milestones.length > 0 && totalPrice > 0) {
      const today = new Date()
      const cashFlowRows = paymentTerms.milestones.map((milestone, idx) => {
        const amount = Math.round((totalPrice * milestone.pct) / 100 * 100) / 100
        const expectedDate = new Date(today)
        if (idx > 0) {
          expectedDate.setDate(
            expectedDate.getDate() + (paymentTerms.net_days || 30) * idx
          )
        }
        return {
          project_id: project.id,
          type: 'receivable',
          description: `${milestone.label} — ${milestone.pct}%`,
          amount,
          expected_date: expectedDate.toISOString().split('T')[0],
          status: 'projected',
          source: 'system',
          milestone_trigger: milestone.trigger || null,
          display_order: idx + 1,
        }
      })

      const { error } = await db.from('cash_flow_receivables').insert(cashFlowRows)
      if (error) console.error('Error creating cash_flow_receivables:', error)
    }
  } catch (err) {
    console.error('Error generating cash_flow (non-blocking):', err)
  }

  // 5. Setup client portal
  try {
    const { setupPortal } = await import('@/lib/portal')
    const portal = await setupPortal(project.id, lead.lead_name)
    if (portal) {
      console.log(
        `Portal created for ${lead.lead_name}: slug=${portal.slug}, password=${portal.password}`
      )
      // Email delivery is not wired yet — Pro+AI email flows come in a later sprint.
      // The sold-handoff UI shows the slug + password so the shop can deliver it manually for now.
    }
  } catch (err) {
    console.error('Error setting up portal (non-blocking):', err)
  }

  // 6. Mark lead as converted
  await db
    .from('leads')
    .update({
      status: 'sold',
      converted_to_project_id: project.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)

  // 7. Copy lead comments to project
  const { data: leadComments } = await db
    .from('comments')
    .select('*')
    .eq('entity_type', 'lead')
    .eq('entity_id', leadId)
    .order('created_at', { ascending: true })

  if (leadComments && leadComments.length > 0) {
    const projectComments = leadComments.map(c => ({
      entity_type: 'project' as const,
      entity_id: project.id,
      content: c.content,
      author: c.author,
      author_id: c.author_id,
      mentions: c.mentions || [],
      source_lead_id: leadId,
    }))
    const { error } = await db.from('comments').insert(projectComments)
    if (error) console.error('Error copying comments:', error)
  }

  return project as Project
}

// ===========================
// Auto-advance production phase
// ===========================
//
// pre_production → scheduling: all non-voided selections confirmed + each sub has
//                              an approved non-stale drawing (or drawing_not_required)
// scheduling → in_production: any time entry logged against the project

export async function checkAndAdvanceProductionPhase(
  projectId: string
): Promise<string | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, status, production_phase')
    .eq('id', projectId)
    .single()

  if (!project) return null
  if (project.status !== 'active') return project.production_phase

  // ── pre_production → scheduling ──
  if (project.production_phase === 'pre_production') {
    const { data: subs } = await supabase
      .from('subprojects')
      .select('id')
      .eq('project_id', projectId)

    if (!subs || subs.length === 0) return project.production_phase

    const subIds = subs.map(s => s.id)

    const { data: selections } = await supabase
      .from('selections')
      .select('id, status')
      .eq('project_id', projectId)
      .neq('status', 'voided')

    if (selections && selections.length > 0) {
      if (!selections.every(s => s.status === 'confirmed')) {
        return project.production_phase
      }
    }

    const { data: drawings } = await supabase
      .from('drawing_revisions')
      .select('subproject_id, status, is_stale')
      .eq('project_id', projectId)

    // Only gate on drawings if the shop has actually uploaded any. A selections-only
    // workflow (no drawings tracked) advances as soon as selections are confirmed.
    if (drawings && drawings.length > 0) {
      const subsApproved = new Set<string>()
      for (const d of drawings) {
        if (d.status === 'approved' && !d.is_stale && d.subproject_id) {
          subsApproved.add(d.subproject_id)
        }
      }

      const allHaveDrawings = subIds.every(id => subsApproved.has(id))
      if (!allHaveDrawings) return project.production_phase
    }

    await supabase
      .from('projects')
      .update({
        production_phase: 'scheduling',
        portal_step: 'scheduling',
        approvals_complete_date: new Date().toISOString().split('T')[0],
      })
      .eq('id', projectId)

    await supabase.from('portal_timeline').insert({
      project_id: projectId,
      event_type: 'step_change',
      event_label: 'All Approvals Complete',
      event_detail: 'Selections and drawings approved — moving to scheduling',
      portal_step: 'scheduling',
      actor_type: 'system',
      triggered_by: 'system',
    })

    // Fire Klaviyo email to the homeowner announcing scheduling has started.
    await firePortalStepEmail(projectId, 'scheduling')

    return 'scheduling'
  }

  // ── scheduling → in_production ──
  if (project.production_phase === 'scheduling') {
    const { data: timeEntries } = await supabase
      .from('time_entries')
      .select('id')
      .eq('project_id', projectId)
      .limit(1)

    if (!timeEntries || timeEntries.length === 0) return project.production_phase

    await supabase
      .from('projects')
      .update({ production_phase: 'in_production', portal_step: 'in_production' })
      .eq('id', projectId)

    await firePortalStepEmail(projectId, 'in_production')

    return 'in_production'
  }

  return project.production_phase
}
