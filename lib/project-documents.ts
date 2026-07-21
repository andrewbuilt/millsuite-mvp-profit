// ============================================================================
// lib/project-documents.ts — manual reference links attached to a project
// ============================================================================
// Backs the "+ document link" rows in the project Documents section (CO step
// 7). Auto-derived docs (estimate PDF, contract/CO invoices) are computed on
// the page from existing tables; this only covers the operator-added links.
// Guarded so the page still renders if migration 068 hasn't run yet.
// ============================================================================

import { supabase } from './supabase'

export interface ProjectDocument {
  id: string
  project_id: string
  label: string
  url: string
  kind: string
  created_at: string
}

export async function loadProjectDocuments(
  projectId: string,
): Promise<ProjectDocument[]> {
  const { data, error } = await supabase
    .from('project_documents')
    .select('id, project_id, label, url, kind, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) {
    // Missing table (068 not run) or RLS — fail soft so the page renders.
    console.error('loadProjectDocuments', error)
    return []
  }
  return (data || []) as ProjectDocument[]
}

export async function addProjectDocument(input: {
  project_id: string
  label: string
  url: string
  kind?: string
}): Promise<ProjectDocument | null> {
  const url = normalizeUrl(input.url)
  const { data, error } = await supabase
    .from('project_documents')
    .insert({
      project_id: input.project_id,
      label: input.label.trim() || url,
      url,
      kind: input.kind ?? 'link',
    })
    .select('id, project_id, label, url, kind, created_at')
    .single()
  if (error) {
    console.error('addProjectDocument', error)
    return null
  }
  return data as ProjectDocument
}

export async function deleteProjectDocument(id: string): Promise<void> {
  const { error } = await supabase.from('project_documents').delete().eq('id', id)
  if (error) {
    console.error('deleteProjectDocument', error)
    throw error
  }
}

/** Add a scheme if the operator pasted a bare host (drive.google.com/…). */
function normalizeUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return s
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s}`
}
