'use client'

// ============================================================================
// TempProjectModal — "+ Temp project" (October batch item 9, migration 117)
// ============================================================================
// A name and rows of {subproject, hours per department}. That's all a temp
// project is — see lib/temp-projects for what it deliberately is NOT.
// ============================================================================

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { createTempProject } from '@/lib/temp-projects'
import { LABOR_DEPTS, LABOR_DEPT_LABEL, type LaborDept } from '@/lib/rate-book-seed'

type Row = { name: string; hours: Record<LaborDept, string> }

const emptyRow = (): Row => ({
  name: '',
  hours: { eng: '', cnc: '', assembly: '', finish: '', install: '' },
})

export default function TempProjectModal({
  orgId,
  onClose,
  onCreated,
}: {
  orgId: string
  onClose: () => void
  onCreated: (projectId: string) => void
}) {
  const [name, setName] = useState('')
  const [rows, setRows] = useState<Row[]>([emptyRow()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const id = await createTempProject({
        orgId,
        name,
        subs: rows.map((r) => ({
          name: r.name,
          hours: Object.fromEntries(
            LABOR_DEPTS.map((d) => [d, parseFloat(r.hours[d]) || 0]),
          ) as Record<LaborDept, number>,
        })),
      })
      onCreated(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the project.')
      setSaving(false)
    }
  }

  const cell =
    'w-full px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]'

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl">
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">New temp project</h2>
            <p className="text-xs text-[#9CA3AF] mt-0.5">
              Hours only — for tracking time on jobs that were never estimated here. No money,
              estimate or payments; left out of sales, reports, capacity and the schedule.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-[#9CA3AF] hover:bg-[#F3F4F6]" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="block text-xs font-medium text-[#6B7280] mb-1">Project name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className={cell}
              placeholder="e.g. Smith kitchen (old job)"
            />
          </label>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  <th className="text-left pb-1.5 pr-2">Subproject</th>
                  {LABOR_DEPTS.map((d) => (
                    <th key={d} className="text-left pb-1.5 px-1 w-[88px]">
                      {LABOR_DEPT_LABEL[d]} hrs
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="pr-2 py-1">
                      <input
                        value={r.name}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                        className={cell}
                        placeholder="e.g. Island"
                      />
                    </td>
                    {LABOR_DEPTS.map((d) => (
                      <td key={d} className="px-1 py-1">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          inputMode="decimal"
                          value={r.hours[d]}
                          onChange={(e) => setRow(i, { hours: { ...r.hours, [d]: e.target.value } })}
                          className={`${cell} font-mono`}
                        />
                      </td>
                    ))}
                    <td className="py-1 pl-1">
                      {rows.length > 1 && (
                        <button
                          onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                          className="p-1 rounded-lg text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2]"
                          aria-label="Remove row"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
            className="inline-flex items-center gap-1 text-[13px] text-[#2563EB] hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add subproject
          </button>

          {error && (
            <div className="text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#E5E7EB] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB]"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create temp project'}
          </button>
        </div>
      </div>
    </div>
  )
}
