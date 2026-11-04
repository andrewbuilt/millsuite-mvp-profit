// ============================================================================
// scripts/login-refs.mjs — every column that stamps a users.id on history
// ============================================================================
// Shared by inspect-duplicate-logins (report) and fix-duplicate-logins
// (delete guard). ⚠️ A column missing here reads as "nothing attached — safe
// to delete". scripts/verify-one-login.mjs re-derives the list from every
// `REFERENCES users(id)` in db/migrations and fails when one is missing.
// (2026-11-04: task_comments was listed as author_id — the column is
// author_user_id — and 124/125's six columns were absent.)
// The FK-less ones stay listed by hand: they hold users.id without a
// constraint (each checked against its migration, 2026-11-04).
//
// ⚠️ NOT HERE ON PURPOSE: tasks.assignee_ids holds ROSTER ids
// (team_members[].id — lib/tasks.ts), not login ids, so a login can't be
// "assigned" anything; the roster link is what the report's roster line
// covers. (The first run listed `tasks.assigned_to` and
// `time_entries.created_by` — neither column exists — and
// `drawing_revisions.uploaded_by`, which is `uploaded_by_user_id`.)
// ============================================================================

export const LOGIN_REFS = [
  ['tasks', 'created_by'],
  ['tasks', 'completed_by'], // 114
  ['task_comments', 'author_user_id'],
  ['time_entries', 'user_id'],
  ['time_entries', 'edited_by'], // 117
  ['pto_requests', 'approved_by'],
  ['co_docs', 'accepted_by'],
  ['project_payments', 'created_by'],
  ['comments', 'author_id'],
  ['project_events', 'actor_user_id'],
  ['drawing_revisions', 'uploaded_by_user_id'], // 002
  ['suggestions', 'created_by'],
  ['invoices', 'entered_by'],
  ['invoices', 'edited_by'],
  ['project_comments', 'author_id'],
  ['project_comment_mentions', 'user_id'],
  ['employee_reviews', 'author_id'],
  ['employee_notes', 'author_id'],
]

/**
 * What's stamped on a users.id. Also checks the one jsonb LIST of login ids,
 * orgs.payments_visible_to (115) — a deleted login left in it is harmless but
 * should be taken out on /settings. `unchecked` = columns the read failed on —
 * a caller that DELETES must treat any unchecked column as a refusal.
 */
export async function loginReferences(db, userId) {
  const hits = []
  const unchecked = []
  let total = 0
  for (const [table, col] of LOGIN_REFS) {
    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq(col, userId)
    if (error) {
      unchecked.push(`${table}.${col} (${error.code || error.message})`)
      continue
    }
    if ((count || 0) > 0) {
      hits.push(`${table}.${col}=${count}`)
      total += count || 0
    }
  }
  {
    const { data, error } = await db.from('orgs').select('name, payments_visible_to').contains('payments_visible_to', [userId])
    if (error) unchecked.push(`orgs.payments_visible_to (${error.code || error.message})`)
    else if (data?.length) {
      hits.push(`orgs.payments_visible_to (${data.map((o) => o.name).join(', ')})`)
      total += data.length
    }
  }
  return { hits, unchecked, total }
}
