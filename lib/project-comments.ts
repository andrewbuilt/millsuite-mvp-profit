// ============================================================================
// lib/project-comments.ts — project notes with @mentions (125, November item 3)
// ============================================================================
// Timestamped notes on a project: handoff meeting notes, site notes, sales
// context. Shown on the pre-production page AND the project page. The client
// portal never reads these tables.
//
// @mentions follow the close-the-loop pattern (114), not email: a mention is a
// row in `project_comment_mentions` for the mentioned LOGIN, sitting in their
// Mentions strip (on /pm, and /me for workers) until they close it out
// (`acknowledged_at`). One row per person, so each closes their own.
//
// ⛔ TWO ID SPACES (the lib/tasks rule). `author_id` and mention `user_id` are
// LOGIN ids (users.id). People are picked from the ROSTER — only rows with a
// login (`team_members[].user_id`) can be mentioned, because a mention has to
// land in someone's session. Names come from the roster too
// (lib/roster-names): a manager's session can't read other `users` rows.
// ============================================================================

import { supabase } from './supabase'

export interface ProjectComment {
  id: string
  org_id: string
  project_id: string
  author_id: string | null
  body: string
  created_at: string
}

export interface Mentionable {
  userId: string
  name: string
}

export interface MyMention {
  id: string
  created_at: string
  project_id: string
  project_name: string
  comment_id: string
  body: string
  author_id: string | null
}

const missingTable = (msg: string) => /project_comment|does not exist|schema cache/i.test(msg)

export async function listProjectComments(projectId: string): Promise<ProjectComment[]> {
  const { data, error } = await supabase
    .from('project_comments')
    .select('id, org_id, project_id, author_id, body, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) {
    if (missingTable(error.message)) return []
    throw new Error(error.message)
  }
  return (data || []) as ProjectComment[]
}

/**
 * The people a note actually mentions: picked from the menu AND still written
 * in the body as "@Name" (deleting the text un-mentions them). Never yourself.
 */
export function mentionsInBody(body: string, picked: Mentionable[], authorId: string | null): string[] {
  const out = new Set<string>()
  for (const p of picked) {
    if (p.userId === authorId) continue
    if (body.includes(`@${p.name}`)) out.add(p.userId)
  }
  return [...out]
}

export async function addProjectComment(args: {
  orgId: string
  projectId: string
  authorId: string
  body: string
  mentionUserIds: string[]
}): Promise<ProjectComment> {
  const body = args.body.trim()
  if (!body) throw new Error('Write something first.')
  const { data, error } = await supabase
    .from('project_comments')
    .insert({ org_id: args.orgId, project_id: args.projectId, author_id: args.authorId, body })
    .select('id, org_id, project_id, author_id, body, created_at')
    .single()
  if (error) throw new Error(missingTable(error.message) ? 'Run migration 125 first.' : error.message)
  const comment = data as ProjectComment
  if (args.mentionUserIds.length) {
    const { error: mErr } = await supabase.from('project_comment_mentions').insert(
      args.mentionUserIds.map((userId) => ({
        org_id: args.orgId,
        project_id: args.projectId,
        comment_id: comment.id,
        user_id: userId,
      })),
    )
    // The note is saved; say the mention didn't land rather than pretend.
    if (mErr) throw new Error(`Note saved, but the @mention didn't go through: ${mErr.message}`)
  }
  return comment
}

export async function deleteProjectComment(id: string): Promise<void> {
  const { data, error } = await supabase.from('project_comments').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Only the person who wrote a note can delete it.')
}

/** My open mentions, newest first — the strip's rows. */
export async function listMyMentions(userId: string): Promise<MyMention[]> {
  const { data, error } = await supabase
    .from('project_comment_mentions')
    .select('id, created_at, project_id, comment_id, project:projects(name), comment:project_comments(body, author_id)')
    .eq('user_id', userId)
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) {
    if (missingTable(error.message)) return []
    console.error('listMyMentions', error)
    return []
  }
  type Row = {
    id: string
    created_at: string
    project_id: string
    comment_id: string
    project: { name: string } | { name: string }[] | null
    comment: { body: string; author_id: string | null } | { body: string; author_id: string | null }[] | null
  }
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
  return ((data || []) as Row[])
    .map((r) => {
      const c = one(r.comment)
      return {
        id: r.id,
        created_at: r.created_at,
        project_id: r.project_id,
        project_name: one(r.project)?.name || 'Project',
        comment_id: r.comment_id,
        body: c?.body || '',
        author_id: c?.author_id ?? null,
      }
    })
    .filter((m) => m.body) // the note was deleted — nothing to read
}

export async function countMyMentions(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('project_comment_mentions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('acknowledged_at', null)
  if (error) return 0
  return count || 0
}

export async function acknowledgeMention(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('project_comment_mentions')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('Could not close that out.')
}

/** Close out every open mention I have on one project — opening the notes
 *  pane IS reading them. */
export async function acknowledgeMyMentionsOn(userId: string, projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('project_comment_mentions')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .is('acknowledged_at', null)
    .select('id')
  if (error) return 0
  return data?.length || 0
}

/** Mention-able people: roster rows with a login, active only. */
export async function listMentionable(orgId: string): Promise<Mentionable[]> {
  const { data, error } = await supabase.from('orgs').select('team_members').eq('id', orgId).maybeSingle()
  if (error) return []
  const raw = (data as { team_members?: unknown } | null)?.team_members
  return ((Array.isArray(raw) ? raw : []) as Record<string, unknown>[])
    .filter((m) => m?.user_id && m?.active !== false && String(m?.name ?? '').trim())
    .map((m) => ({ userId: String(m.user_id), name: String(m.name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Split a note body into text and "@Name" runs for highlighting. */
export function splitMentions(body: string, names: string[]): Array<{ text: string; mention: boolean }> {
  const sorted = [...names].sort((a, b) => b.length - a.length).filter(Boolean)
  if (sorted.length === 0) return [{ text: body, mention: false }]
  const esc = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`@(?:${esc.join('|')})`, 'g')
  const out: Array<{ text: string; mention: boolean }> = []
  let last = 0
  for (const m of body.matchAll(re)) {
    if (m.index! > last) out.push({ text: body.slice(last, m.index), mention: false })
    out.push({ text: m[0], mention: true })
    last = m.index! + m[0].length
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false })
  return out
}
