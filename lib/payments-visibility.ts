// ============================================================================
// lib/payments-visibility.ts — who sees money movement (migration 115)
// ============================================================================
// The org carries `payments_visible_to`: a jsonb array of LOGIN ids
// (users.id) or NULL for "everyone". RLS enforces it (can_see_payments in
// 115); this module is the UI's copy of the same rule, used to HIDE the
// surfaces rather than render them empty — an unlisted manager should see
// "not part of your view", not a payments board full of zero rows that
// looks like the shop earned nothing.
//
// ⛔ KEEP THE CLIENT RULE IDENTICAL TO THE POLICY: owner always · null list =
// everyone · else membership. If the two drift, someone sees an empty board
// (UI says yes, database says no) or a hidden one they were entitled to.
// ============================================================================

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { updateOrgChecked } from './org-write'
import { useAuth } from './auth-context'

/** Null = not configured — everyone in the org sees payments. */
export async function loadPaymentsVisibleTo(orgId: string): Promise<string[] | null> {
  const { data, error } = await supabase
    .from('orgs')
    .select('payments_visible_to')
    .eq('id', orgId)
    .maybeSingle()
  // Pre-115 (42703) and any read failure degrade to "everyone" — matching
  // what the database enforces before the migration runs.
  if (error) return null
  const raw = (data as { payments_visible_to?: unknown } | null)?.payments_visible_to
  if (!Array.isArray(raw)) return null
  return raw.filter((x): x is string => typeof x === 'string')
}

/** The UI's copy of 115's can_see_payments — keep them identical. */
export function canSeePaymentsClient(
  role: string | undefined,
  userId: string | undefined,
  list: string[] | null,
): boolean {
  if (role === 'owner') return true
  if (list === null) return true
  return !!userId && list.includes(userId)
}

/** Replace the list. Owner-only in practice (the Settings card renders only
 *  for owners) — and `orgs` writes go through updateOrgChecked because a
 *  zero-row org update reports success. */
export async function savePaymentsVisibleTo(orgId: string, userIds: string[]): Promise<void> {
  await updateOrgChecked(orgId, { payments_visible_to: userIds })
}

export interface PaymentsVisibility {
  /** False until the list has loaded — surfaces stay HIDDEN while unknown,
   *  so an unlisted person never sees money flash before the gate lands. */
  canSee: boolean
  loading: boolean
  list: string[] | null
  refresh: () => Promise<void>
}

export function usePaymentsVisibility(): PaymentsVisibility {
  const { org, user } = useAuth()
  const [list, setList] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)

  const orgId = org?.id

  async function load() {
    if (!orgId) return
    setList(await loadPaymentsVisibleTo(orgId))
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    if (!orgId) return
    ;(async () => {
      const l = await loadPaymentsVisibleTo(orgId)
      if (!cancelled) {
        setList(l)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  return {
    // The owner never waits on the load — they can't be locked out, and
    // making Andrew's own board flash hidden on every visit would be noise.
    // Everyone else stays hidden until the list has actually answered.
    canSee:
      user?.role === 'owner' || (!loading && canSeePaymentsClient(user?.role, user?.id, list)),
    loading,
    list,
    refresh: load,
  }
}
