'use client'

// ============================================================================
// use-tag-filter — the tag filter row's state.
// ============================================================================
// ⛔ CALLED EXACTLY ONCE, BY TasksProvider. Both surfaces read the result off
// the context.
//
// The first cut had each surface call this hook itself, which does NOT give
// you shared state — it gives you two copies racing over one localStorage key.
// And the drawer is mounted unconditionally in the app layout (it returns null
// late, after its hooks have run), so on /tasks both copies were live at once:
// filter by tag on the page, open the drawer, and the drawer showed the stale
// set and filtered its own list by it. Whichever surface you touched last
// clobbered the other's saved value.
//
// SEMANTICS, because this is the kind of thing that gets guessed wrong later:
//   · No tags selected = NO FILTER. Not "show untagged".
//   · Several selected = OR, not AND. A shop picks "Shop" and "Punch list" to
//     mean "either of these", and AND would usually return nothing, which
//     reads as a broken filter.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import type { Task } from '@/lib/tasks'

const TAG_FILTER_KEY = 'millsuite.tasks.tagFilter'

export function useTagFilterState() {
  const [selected, setSelected] = useState<string[]>([])

  // Read once on mount; writing back on every render would fight the user
  // mid-click. Same pattern as the person filter.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TAG_FILTER_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setSelected(parsed.filter((x) => typeof x === 'string'))
      }
    } catch {
      /* private mode / corrupt value — no filter is a fine default */
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(TAG_FILTER_KEY, JSON.stringify(selected))
    } catch {
      /* ignore */
    }
  }, [selected])

  const toggle = useCallback((name: string) => {
    setSelected((prev) =>
      prev.some((x) => x.toLowerCase() === name.toLowerCase())
        ? prev.filter((x) => x.toLowerCase() !== name.toLowerCase())
        : [...prev, name],
    )
  }, [])

  const clear = useCallback(() => setSelected([]), [])

  return { selected, toggle, clear }
}

/** OR across the selected tags; an empty selection matches everything. */
export function matchesTagFilter(task: Task, selected: string[]): boolean {
  if (selected.length === 0) return true
  const has = new Set(task.tags.map((t) => t.toLowerCase()))
  return selected.some((s) => has.has(s.toLowerCase()))
}
