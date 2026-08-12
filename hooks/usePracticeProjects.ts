'use client'

// ============================================================================
// usePracticeProjects — which of this org's projects are walkthrough scratch
// ============================================================================
// A separate read rather than `practice_at` in each page's existing select, for
// the reason spelled out in lib/practice.ts: selecting a column that migration
// 088 hasn't added yet fails the ENTIRE query, so folding it into the project
// list select would blank the kanban board and the projects roster on any
// deploy that lands ahead of the migration. This way a pre-088 database
// answers "none" and every page renders exactly as it does today.
// ============================================================================

import { useEffect, useState } from 'react'
import { loadPracticeProjectIds } from '@/lib/practice'

export function usePracticeProjects(orgId: string | undefined | null): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    void loadPracticeProjectIds(orgId).then((s) => {
      if (!cancelled) setIds(s)
    })
    return () => {
      cancelled = true
    }
  }, [orgId])

  return ids
}
