'use client'

// useTempProjects — which of this org's projects are hours-only temp jobs
// (117). Separate read for the same reason as usePracticeProjects: a pre-117
// database must answer "none", not fail the page's own project select.

import { useEffect, useState } from 'react'
import { loadTempProjectIds } from '@/lib/temp-projects'

export function useTempProjects(orgId: string | undefined | null, reloadKey = 0): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    void loadTempProjectIds(orgId).then((s) => {
      if (!cancelled) setIds(s)
    })
    return () => {
      cancelled = true
    }
  }, [orgId, reloadKey])
  return ids
}
