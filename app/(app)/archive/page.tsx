'use client'

// ============================================================================
// /archive — Manage → Archive (migration 119). Completed and lost projects the
// shop chose to file away. DISPLAY ONLY: every report still counts them
// (lib/project-archive). Grouped Completed / Lost, each by month, newest
// first; search across both; every row links to the project and can be
// unarchived in place. /sales/lost stays the lost-analytics view.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { listArchivedProjects, unarchiveProject, type ArchivedProject } from '@/lib/project-archive'
import { matchesProjectSearch, normalizeQuery } from '@/lib/project-search'
import { Search, X } from 'lucide-react'

function money(n: number): string {
  return n > 0 ? `$${Math.round(n).toLocaleString()}` : '—'
}

function monthLabel(ym: string): string {
  if (ym === 'unknown') return 'Date unknown'
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

/** The month a row belongs to: when it finished (completed / lost), else when
 *  it was archived. Never a guess beyond those stamps. */
function monthOf(r: ArchivedProject): string {
  const stamp = r.stage === 'lost' ? r.lost_at : r.completed_at
  return (stamp || r.archived_at || '').slice(0, 7) || 'unknown'
}

function groupByMonth(rows: ArchivedProject[]): Array<[string, ArchivedProject[]]> {
  const m = new Map<string, ArchivedProject[]>()
  for (const r of rows) {
    const k = monthOf(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return [...m.entries()].sort((a, b) =>
    a[0] === 'unknown' ? 1 : b[0] === 'unknown' ? -1 : b[0].localeCompare(a[0]),
  )
}

export default function ArchivePage() {
  const { org } = useAuth()
  const [rows, setRows] = useState<ArchivedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    listArchivedProjects(org.id).then((r) => {
      if (cancelled) return
      setRows(r)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [org?.id])

  const visible = useMemo(() => {
    const q = normalizeQuery(query)
    return rows.filter((r) => matchesProjectSearch(r, q))
  }, [rows, query])

  const sections = useMemo(
    () => [
      { key: 'complete', title: 'Completed', groups: groupByMonth(visible.filter((r) => r.stage !== 'lost')) },
      { key: 'lost', title: 'Lost', groups: groupByMonth(visible.filter((r) => r.stage === 'lost')) },
    ],
    [visible],
  )

  async function unarchive(r: ArchivedProject) {
    setBusy(r.id)
    try {
      await unarchiveProject(r.id)
      setRows((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not unarchive.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-6">
      <h1 className="text-xl font-semibold tracking-tight text-[#111]">Archive</h1>
      <p className="text-xs text-[#6B7280] mt-0.5">
        Completed and lost projects filed away from the board and the projects list. They still count in
        reports — archiving never removes data.
      </p>

      <div className="relative mt-4 max-w-sm">
        <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search archived projects"
          className="w-full pl-9 pr-8 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white outline-none focus:border-[#2563EB]"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#9CA3AF] hover:text-[#111]"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-[#9CA3AF] py-16 text-center">
          Nothing archived yet. Archive a completed job from its card on Projects, or a lost one from the board&apos;s
          ⋯ menu.
        </div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-[#9CA3AF] py-16 text-center">No archived projects match that search.</div>
      ) : (
        sections.map(
          (sec) =>
            sec.groups.length > 0 && (
              <div key={sec.key} className="mt-8">
                <h2 className="text-sm font-semibold text-[#111]">{sec.title}</h2>
                {sec.groups.map(([month, list]) => (
                  <section key={month} className="mt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-2">
                      {monthLabel(month)}{' '}
                      <span className="text-[#D1D5DB] normal-case tracking-normal">
                        · {list.length} · {money(list.reduce((s, r) => s + r.value, 0))}
                      </span>
                    </div>
                    <div className="bg-white border border-[#E5E7EB] rounded-xl divide-y divide-[#F3F4F6]">
                      {list.map((r) => (
                        <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                          <Link href={`/projects/${r.id}`} className="min-w-0 flex-1 hover:underline">
                            <span className="text-[13.5px] font-medium text-[#111]">{r.name}</span>
                            {r.client_name && <span className="ml-2 text-[11px] text-[#6B7280]">{r.client_name}</span>}
                          </Link>
                          <span className="text-[12.5px] font-mono tabular-nums text-[#374151]">{money(r.value)}</span>
                          <button
                            onClick={() => unarchive(r)}
                            disabled={busy === r.id}
                            className="px-2.5 py-1 text-[11.5px] font-semibold rounded-md border border-[#E5E7EB] text-[#374151] hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-50"
                          >
                            {busy === r.id ? 'Restoring…' : 'Unarchive'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ),
        )
      )}
    </div>
  )
}
