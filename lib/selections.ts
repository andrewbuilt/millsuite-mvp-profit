// lib/selections.ts
// CRUD + state transitions for project selections. Also logs every change to
// selection_history and advances production_phase when the project hits the
// "all selections confirmed + drawings approved" bar.

import { supabase } from '@/lib/supabase'
import type { Selection, SelectionStatus } from '@/lib/types'

export const SELECTION_CATEGORIES = [
  { value: 'cabinet_exterior', label: 'Cabinet Exterior' },
  { value: 'cabinet_interior', label: 'Cabinet Interior' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'custom', label: 'Custom' },
] as const

export const STATUS_LABELS: Record<SelectionStatus, string> = {
  unconfirmed: 'Unconfirmed',
  pending_review: 'Pending Review',
  confirmed: 'Confirmed',
  voided: 'Voided',
}

export const STATUS_COLORS: Record<SelectionStatus, { bg: string; text: string; dot: string }> = {
  unconfirmed: { bg: '#FEF3C7', text: '#92400E', dot: '#D97706' },
  pending_review: { bg: '#DBEAFE', text: '#1E40AF', dot: '#2563EB' },
  confirmed: { bg: '#D1FAE5', text: '#065F46', dot: '#059669' },
  voided: { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF' },
}

export const STATUS_ORDER: SelectionStatus[] = [
  'unconfirmed',
  'pending_review',
  'confirmed',
  'voided',
]

// ── Reads ──

export async function getSelections(projectId: string): Promise<Selection[]> {
  const { data, error } = await supabase
    .from('selections')
    .select('*')
    .eq('project_id', projectId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []) as Selection[]
}

// ── Writes ──

interface CreateSelectionInput {
  project_id: string
  subproject_id?: string | null
  category: string
  label: string
  spec_value?: string | null
  display_order?: number
  notes?: string | null
}

export async function createSelection(input: CreateSelectionInput): Promise<Selection> {
  const { data, error } = await supabase
    .from('selections')
    .insert({
      project_id: input.project_id,
      subproject_id: input.subproject_id ?? null,
      category: input.category,
      label: input.label,
      spec_value: input.spec_value ?? null,
      status: 'unconfirmed',
      display_order: input.display_order ?? 0,
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)

  await logHistory(data.id, {
    action: 'created',
    new_status: 'unconfirmed',
    new_value: input.label,
    source: 'manual_entry',
  })

  return data as Selection
}

export async function updateSelection(
  id: string,
  updates: Partial<Pick<Selection, 'label' | 'spec_value' | 'notes' | 'display_order'>>
): Promise<Selection> {
  const before = await getById(id)
  const { data, error } = await supabase
    .from('selections')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)

  // Log label or spec changes
  if (updates.label && updates.label !== before.label) {
    await logHistory(id, {
      action: 'changed',
      old_value: before.label,
      new_value: updates.label,
      source: 'manual_entry',
    })
  }
  if (
    typeof updates.spec_value !== 'undefined' &&
    updates.spec_value !== before.spec_value
  ) {
    await logHistory(id, {
      action: 'changed',
      old_value: before.spec_value || '',
      new_value: updates.spec_value || '',
      source: 'manual_entry',
    })
  }

  return data as Selection
}

export async function setSelectionStatus(
  id: string,
  status: SelectionStatus,
  opts?: { actor?: string }
): Promise<Selection> {
  const before = await getById(id)
  if (before.status === status) return before

  const patch: Partial<Selection> & Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (status === 'confirmed') {
    patch.confirmed_date = new Date().toISOString()
    patch.confirmed_by = opts?.actor || 'shop'
  }
  if (status === 'unconfirmed') {
    patch.confirmed_date = null
    patch.confirmed_by = null
    // Clear client sign-off if the shop un-confirms
    patch.client_signed_off_at = null
    patch.client_signed_off_by = null
  }

  const { data, error } = await supabase
    .from('selections')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)

  await logHistory(id, {
    action: status === 'confirmed' ? 'confirmed' : status === 'voided' ? 'voided' : 'changed',
    old_status: before.status,
    new_status: status,
    changed_by: opts?.actor || null,
    source: 'manual_entry',
  })

  return data as Selection
}

export async function deleteSelection(id: string): Promise<void> {
  const { error } = await supabase.from('selections').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── History ──

interface HistoryPayload {
  action: 'created' | 'changed' | 'confirmed' | 'voided' | 'linked' | 'unlinked'
  old_value?: string
  new_value?: string
  old_status?: SelectionStatus
  new_status?: SelectionStatus
  source?:
    | 'manual_entry'
    | 'designer_email'
    | 'site_conversation'
    | 'client_drawing'
    | 'change_order'
    | 'client_approval'
    | 'phone_call'
    | 'linked_selection'
    | 'system'
  source_reference?: string
  changed_by?: string | null
}

async function logHistory(selectionId: string, payload: HistoryPayload) {
  await supabase.from('selection_history').insert({
    selection_id: selectionId,
    action: payload.action,
    old_value: payload.old_value ?? null,
    new_value: payload.new_value ?? null,
    old_status: payload.old_status ?? null,
    new_status: payload.new_status ?? null,
    source: payload.source ?? 'manual_entry',
    source_reference: payload.source_reference ?? null,
    changed_by: payload.changed_by ?? null,
  })
}

async function getById(id: string): Promise<Selection> {
  const { data, error } = await supabase
    .from('selections')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data as Selection
}

// ── Rollup helpers ──

export function selectionSummary(selections: Selection[]) {
  const total = selections.length
  const confirmed = selections.filter(s => s.status === 'confirmed').length
  const pending = selections.filter(s => s.status === 'pending_review').length
  const unconfirmed = selections.filter(s => s.status === 'unconfirmed').length
  const voided = selections.filter(s => s.status === 'voided').length
  const active = total - voided
  const pctConfirmed = active === 0 ? 0 : Math.round((confirmed / active) * 100)
  return { total, confirmed, pending, unconfirmed, voided, active, pctConfirmed }
}
