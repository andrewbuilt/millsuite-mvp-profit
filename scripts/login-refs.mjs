// ============================================================================
// scripts/login-refs.mjs — every column that stamps a users.id on history
// ============================================================================
// Shared by inspect-duplicate-logins (report) and fix-duplicate-logins
// (delete guard). ⚠️ A column missing here reads as "nothing attached — safe
// to delete". scripts/verify-one-login.mjs re-derives the list from every
// `REFERENCES users(id)` in db/migrations and fails when one is missing.
// (2026-11-04: task_comments was listed as author_id — the column is
// author_user_id — and 124/125's six columns were absent.)
// The FK-less ones (time_entries, co_docs, drawing_revisions, suggestions)
// stay listed by hand: they hold users.id without a constraint.
// ============================================================================

export const LOGIN_REFS = [
  ['tasks', 'assigned_to'],
  ['tasks', 'created_by'],
  ['task_comments', 'author_user_id'],
  ['time_entries', 'user_id'],
  ['time_entries', 'created_by'],
  ['pto_requests', 'approved_by'],
  ['co_docs', 'accepted_by'],
  ['project_payments', 'created_by'],
  ['comments', 'author_id'],
  ['project_events', 'actor_user_id'],
  ['drawing_revisions', 'uploaded_by'],
  ['suggestions', 'created_by'],
  ['invoices', 'entered_by'],
  ['invoices', 'edited_by'],
  ['project_comments', 'author_id'],
  ['project_comment_mentions', 'user_id'],
  ['employee_reviews', 'author_id'],
  ['employee_notes', 'author_id'],
]

/**
 * What's stamped on a users.id. `unchecked` = columns the read failed on —
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
  return { hits, unchecked, total }
}
