'use client'

// ============================================================================
// HolidaysAndPtoSection — company holidays + manual PTO (capacity_overrides).
// Moved from /settings to /team so managers/admins can run time-off without
// needing owner-only Settings access. Feeds app/(app)/capacity/page.tsx.
// ============================================================================

import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { type TeamMember } from '@/lib/shop-rate-setup'

interface OverrideRow {
  id: string
  override_date: string
  team_member_id: string | null
  department_id: string | null
  reason: string
  hours_reduction: number
}

const HOLIDAY_HOURS_DEFAULT = 8

export default function HolidaysAndPtoSection({
  orgId,
  team,
}: {
  orgId: string | undefined
  /** Roster (names/ids) for the PTO member dropdown — passed in already
   *  comp-stripped so this component never fetches comp itself. */
  team: TeamMember[]
}) {
  const [rows, setRows] = useState<OverrideRow[]>([])
  const [loaded, setLoaded] = useState(false)

  // Inline-add form state — one form per list, both null when closed.
  const [holidayDraft, setHolidayDraft] = useState<{ date: string; reason: string } | null>(null)
  const [ptoDraft, setPtoDraft] = useState<{
    member_id: string
    date: string
    reason: string
    hours: string
  } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('capacity_overrides')
        .select('id, override_date, team_member_id, department_id, reason, hours_reduction')
        .eq('org_id', orgId)
        .order('override_date', { ascending: true })
      if (cancelled) return
      setRows((data || []) as OverrideRow[])
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const billableMembers = useMemo(
    () => team.filter((m) => m.billable && m.name.trim().length > 0),
    [team],
  )
  const memberById = useMemo(() => {
    const m: Record<string, TeamMember> = {}
    for (const t of team) m[t.id] = t
    return m
  }, [team])

  const holidays = rows.filter((r) => r.team_member_id == null)
  const ptos = rows.filter((r) => r.team_member_id != null)

  async function addHoliday() {
    if (!orgId || !holidayDraft) return
    if (!holidayDraft.date) return
    setSaving(true)
    const { data, error } = await supabase
      .from('capacity_overrides')
      .insert({
        org_id: orgId,
        override_date: holidayDraft.date,
        team_member_id: null,
        reason: holidayDraft.reason.trim(),
        hours_reduction: 0,
        is_full_day: true,
      })
      .select('id, override_date, team_member_id, department_id, reason, hours_reduction')
      .single()
    setSaving(false)
    if (error || !data) {
      console.warn('addHoliday', error)
      return
    }
    setRows((prev) => [...prev, data as OverrideRow])
    setHolidayDraft(null)
  }

  async function addPto() {
    if (!orgId || !ptoDraft) return
    if (!ptoDraft.member_id || !ptoDraft.date) return
    const parsed = Number(ptoDraft.hours)
    const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    setSaving(true)
    const { data, error } = await supabase
      .from('capacity_overrides')
      .insert({
        org_id: orgId,
        override_date: ptoDraft.date,
        team_member_id: ptoDraft.member_id,
        reason: ptoDraft.reason.trim(),
        hours_reduction: hours,
        is_full_day: hours === 0,
      })
      .select('id, override_date, team_member_id, department_id, reason, hours_reduction')
      .single()
    setSaving(false)
    if (error || !data) {
      console.warn('addPto', error)
      return
    }
    setRows((prev) => [...prev, data as OverrideRow])
    setPtoDraft(null)
  }

  async function remove(id: string) {
    const prev = rows
    setRows((p) => p.filter((r) => r.id !== id))
    const { error } = await supabase.from('capacity_overrides').delete().eq('id', id)
    if (error) {
      console.warn('remove override', error)
      setRows(prev) // roll back
    }
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-base font-semibold">Holidays &amp; PTO</h2>
        <p className="text-xs text-[#9CA3AF] mt-0.5">
          Reduce a month's effective capacity. Holidays drop one working day
          for everyone. PTO subtracts a person's hours from the month.
        </p>
      </div>

      <div className="px-6 py-5 space-y-6">
        {/* Company holidays */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#111]">Company holidays</h3>
            {!holidayDraft && (
              <button
                onClick={() => setHolidayDraft({ date: '', reason: '' })}
                className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Add holiday
              </button>
            )}
          </div>

          {!loaded ? (
            <div className="text-xs text-[#9CA3AF]">Loading…</div>
          ) : (
            <>
              {holidays.length === 0 && !holidayDraft && (
                <div className="text-xs text-[#9CA3AF] italic py-1">No holidays yet.</div>
              )}
              <div className="space-y-1">
                {holidays.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 py-1 text-sm"
                  >
                    <span className="font-mono tabular-nums text-[#111] w-28">
                      {h.override_date}
                    </span>
                    <span className="flex-1 text-[#374151]">{h.reason || '—'}</span>
                    <button
                      onClick={() => remove(h.id)}
                      className="text-[#9CA3AF] hover:text-[#DC2626] p-1"
                      title="Delete holiday"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {holidayDraft && (
                  <div className="flex items-center gap-2 py-1">
                    <input
                      type="date"
                      value={holidayDraft.date}
                      onChange={(e) =>
                        setHolidayDraft({ ...holidayDraft, date: e.target.value })
                      }
                      className="px-2 py-1 text-sm font-mono bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="Reason (e.g. Independence Day)"
                      value={holidayDraft.reason}
                      onChange={(e) =>
                        setHolidayDraft({ ...holidayDraft, reason: e.target.value })
                      }
                      className="flex-1 px-3 py-1 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                    />
                    <button
                      onClick={addHoliday}
                      disabled={saving || !holidayDraft.date}
                      className="px-3 py-1 text-xs font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setHolidayDraft(null)}
                      className="px-2 py-1 text-xs text-[#6B7280] hover:text-[#111]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* PTO */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#111]">Time off</h3>
            {!ptoDraft && billableMembers.length > 0 && (
              <button
                onClick={() =>
                  setPtoDraft({
                    member_id: billableMembers[0]?.id ?? '',
                    date: '',
                    reason: '',
                    hours: String(HOLIDAY_HOURS_DEFAULT),
                  })
                }
                className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Add PTO
              </button>
            )}
          </div>

          {!loaded ? (
            <div className="text-xs text-[#9CA3AF]">Loading…</div>
          ) : billableMembers.length === 0 ? (
            <div className="text-xs text-[#9CA3AF] italic">
              Add billable team members on the Team page first.
            </div>
          ) : (
            <>
              {ptos.length === 0 && !ptoDraft && (
                <div className="text-xs text-[#9CA3AF] italic py-1">No PTO yet.</div>
              )}
              <div className="space-y-1">
                {ptos.map((p) => {
                  const member = p.team_member_id ? memberById[p.team_member_id] : null
                  const hoursDisplay =
                    p.hours_reduction > 0 ? `${p.hours_reduction}h` : `${HOLIDAY_HOURS_DEFAULT}h`
                  return (
                    <div key={p.id} className="flex items-center gap-3 py-1 text-sm">
                      <span className="text-[#111] w-32 truncate">
                        {member?.name ?? 'Unknown'}
                      </span>
                      <span className="font-mono tabular-nums text-[#111] w-28">
                        {p.override_date}
                      </span>
                      <span className="flex-1 text-[#374151] truncate">
                        {p.reason || '—'}
                      </span>
                      <span className="font-mono tabular-nums text-[#6B7280] w-12 text-right">
                        {hoursDisplay}
                      </span>
                      <button
                        onClick={() => remove(p.id)}
                        className="text-[#9CA3AF] hover:text-[#DC2626] p-1"
                        title="Delete PTO"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
                {ptoDraft && (
                  <div className="flex items-center gap-2 py-1">
                    <select
                      value={ptoDraft.member_id}
                      onChange={(e) =>
                        setPtoDraft({ ...ptoDraft, member_id: e.target.value })
                      }
                      className="px-2 py-1 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] w-32"
                    >
                      {billableMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={ptoDraft.date}
                      onChange={(e) =>
                        setPtoDraft({ ...ptoDraft, date: e.target.value })
                      }
                      className="px-2 py-1 text-sm font-mono bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                    />
                    <input
                      type="text"
                      placeholder="Reason"
                      value={ptoDraft.reason}
                      onChange={(e) =>
                        setPtoDraft({ ...ptoDraft, reason: e.target.value })
                      }
                      className="flex-1 px-3 py-1 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                    />
                    <input
                      type="number"
                      placeholder="Hours"
                      value={ptoDraft.hours}
                      onChange={(e) =>
                        setPtoDraft({ ...ptoDraft, hours: e.target.value })
                      }
                      className="w-16 px-2 py-1 text-sm font-mono text-right bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                    />
                    <button
                      onClick={addPto}
                      disabled={saving || !ptoDraft.member_id || !ptoDraft.date}
                      className="px-3 py-1 text-xs font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setPtoDraft(null)}
                      className="px-2 py-1 text-xs text-[#6B7280] hover:text-[#111]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
