'use client'

// ============================================================================
// /dev/eng-board — fixture harness for the engineering board (2026-11-04)
// ============================================================================
// Mounts the REAL components/engineering/EngBoard on a Hunter + Evan shaped
// fixture (dates relative to today), with an in-memory api: assign, reorder,
// divide, firm dates and the timer all work and repack, nothing touches the
// database. Dev-only: production builds 404 it.
// ============================================================================

import { useMemo, useRef } from 'react'
import { notFound } from 'next/navigation'
import EngBoard, { type BoardApi } from '@/components/engineering/EngBoard'
import { entryMinutes, type BoardData, type BoardEntry } from '@/lib/eng-board'
import type { TeamMember } from '@/lib/shop-rate-setup'
import { dateKey, workdaysFrom, mondayOfKey } from '@/lib/eng-board-math'

const ENG = 'dept-eng'

function member(id: string, name: string, userId: string | null): TeamMember {
  return { id, name, annual_comp: 0, billable: true, dept_assignments: [ENG], tasks_enabled: true, user_id: userId, hours_per_week: 40, active: true } as TeamMember
}

function fixture(): BoardData {
  const today = dateKey(new Date())
  const mon = mondayOfKey(today)
  const week = workdaysFrom(mon, 5)
  const at = (day: string, h: number, m = 0) => {
    const [y, mo, d] = day.split('-').map(Number)
    return new Date(y, mo - 1, d, h, m).toISOString()
  }
  let n = 0
  const entry = (user: string, project: string, day: string, startH: number, mins: number): BoardEntry => ({
    id: `e${++n}`, user_id: user, project_id: project, subproject_id: null, department_id: ENG,
    started_at: at(day, startH), ended_at: new Date(new Date(at(day, startH)).getTime() + mins * 60000).toISOString(),
    duration_minutes: mins, created_at: at(day, startH), notes: null,
  })
  const past = week.filter((d) => d < today)
  const entries: BoardEntry[] = []
  for (const d of past) {
    entries.push(entry('u-h', 'kinser', d, 7, 180), entry('u-h', 'towers', d, 10, 60), entry('u-h', 'kinser', d, 11, 240))
    entries.push(entry('u-e', 'towers', d, 7, 240), entry('u-e', 'bonzer', d, 11, 120), entry('u-e', 'towers', d, 13, 120))
  }
  entries.push(entry('u-h', 'kinser', today, 7, 150))
  entries.push({
    id: 'live', user_id: 'u-h', project_id: 'kinser', subproject_id: null, department_id: ENG,
    started_at: new Date(Date.now() - 84 * 60000).toISOString(), ended_at: null, duration_minutes: 0, created_at: new Date().toISOString(), notes: null,
  })
  entries.push(entry('u-e', 'towers', today, 7, 150))
  // Round 2: Murtagh is OVER — 2h estimated, 5h tracked last week.
  entries.push(entry('u-h', 'murtagh', past[0] ?? today, 14, 300))
  const trackedFor = (pid: string) => entries.filter((e) => e.project_id === pid && e.ended_at).reduce((s, e) => s + e.duration_minutes, 0)
  const proj = (id: string, name: string, est: number, isTemp = false) => ({ id, name, clientName: null, stage: 'production', isTemp, estHours: est + trackedFor(id) / 60, trackedMinutes: trackedFor(id) })
  // Firm date for Towers: two workdays out — the pack won't make it.
  const firm = workdaysFrom(today, 2)[1]
  return {
    engDeptIds: [ENG],
    engineers: [
      { member: member('m-e', 'Evan Otero', 'u-e'), dailyHours: 8 },
      { member: member('m-h', 'Hunter', 'u-h'), dailyHours: 8 },
      { member: member('m-t', 'Trent Trask', null), dailyHours: 8 },
    ],
    projects: [
      proj('towers', 'Towers – Wall paneling', 18),
      proj('kinser', 'Kinser · part 3', 16),
      proj('jw', 'JW Marriott Ph 2', 11),
      proj('bonzer', 'Bonzer – 400 Central', 16),
      proj('schiller', 'Schiller – A&K', 14),
      proj('pajot', 'Hunt – Pajot', 10),
      proj('temp', 'Shop jig drawings', 6, true),
      // Round 2: over-budget strip, a big-estimate pool job to break out, a
      // second Hunter strip to drag Murtagh-style over.
      { id: 'murtagh', name: 'Murtagh Bar', clientName: null, stage: 'production', isTemp: false, estHours: 2, trackedMinutes: 0 },
      proj('batia', 'Batia', 163.7),
      proj('chancey', 'Chancey – Stone table', 6),
    ],
    assignments: [
      { id: 'a1', org_id: 'o', project_id: 'towers', member_id: 'm-e', dept: 'eng', priority: 1, divisions: null, firm_date: firm, board_hours: null, start_date: null, done_at: null },
      { id: 'a2', org_id: 'o', project_id: 'kinser', member_id: 'm-h', dept: 'eng', priority: 2, divisions: null, firm_date: null, board_hours: null, start_date: null, done_at: null },
      { id: 'a3', org_id: 'o', project_id: 'jw', member_id: 'm-h', dept: 'eng', priority: 3, divisions: null, firm_date: null, board_hours: null, start_date: null, done_at: null },
      { id: 'a4', org_id: 'o', project_id: 'bonzer', member_id: 'm-e', dept: 'eng', priority: 4, divisions: null, firm_date: null, board_hours: null, start_date: null, done_at: null },
      { id: 'a5', org_id: 'o', project_id: 'schiller', member_id: 'm-e', dept: 'eng', priority: 5, divisions: null, firm_date: null, board_hours: null, start_date: null, done_at: null },
      { id: 'a6', org_id: 'o', project_id: 'murtagh', member_id: 'm-h', dept: 'eng', priority: 6, divisions: null, firm_date: null, board_hours: null, start_date: null, done_at: null },
      { id: 'a7', org_id: 'o', project_id: 'chancey', member_id: 'm-h', dept: 'eng', priority: 7, divisions: null, firm_date: null, board_hours: null, start_date: null, done_at: null },
    ],
    entries,
    outByMember: { 'm-e': {}, 'm-h': { [workdaysFrom(today, 6)[5]]: 8 }, 'm-t': {} },
    subsByProject: { kinser: [{ id: 's1', name: 'Kitchen' }, { id: 's2', name: 'Primary bath' }] },
    planError: null,
  }
}

export default function EngBoardFixture() {
  if (process.env.NODE_ENV === 'production') notFound()
  const state = useRef<BoardData>(fixture())
  const api = useMemo<BoardApi>(() => {
    const s = () => state.current
    const tick = () => new Promise<void>((r) => setTimeout(r, 120))
    return {
      // Like loadEngBoard: tracked = every eng entry, running counted to now.
      load: async () => {
        const d: BoardData = JSON.parse(JSON.stringify(s()))
        for (const p of d.projects) p.trackedMinutes = d.entries.filter((e) => e.project_id === p.id).reduce((t, e) => t + entryMinutes(e), 0)
        return d
      },
      assign: async (projectId, memberId, priority, boardHours) => {
        s().assignments.push({ id: `a${Date.now()}`, org_id: 'o', project_id: projectId, member_id: memberId, dept: 'eng', priority, divisions: null, firm_date: null, board_hours: boardHours ?? null, start_date: null, done_at: null })
        await tick()
      },
      setDone: async (id, _projectId, done) => {
        const a = s().assignments.find((x) => x.id === id)
        if (a) a.done_at = done ? new Date().toISOString() : null
        await tick()
      },
      update: async (id, patch) => {
        const a = s().assignments.find((x) => x.id === id)
        if (a) Object.assign(a, patch)
        await tick()
      },
      unassign: async (id) => { s().assignments = s().assignments.filter((a) => a.id !== id); await tick() },
      startTimer: async (userId, projectId, subprojectId, departmentId) => {
        const now = Date.now()
        for (const e of s().entries) {
          if (e.user_id === userId && !e.ended_at) {
            e.ended_at = new Date(now).toISOString()
            e.duration_minutes = Math.round((now - new Date(e.started_at!).getTime()) / 60000)
          }
        }
        s().entries.push({ id: `live${now}`, user_id: userId, project_id: projectId, subproject_id: subprojectId, department_id: departmentId, started_at: new Date(now).toISOString(), ended_at: null, duration_minutes: 0, created_at: new Date(now).toISOString(), notes: null })
        await tick()
      },
      stopTimer: async (entry) => {
        const e = s().entries.find((x) => x.id === entry.id)
        if (e) {
          const now = Date.now()
          e.ended_at = new Date(now).toISOString()
          e.duration_minutes = Math.round((now - new Date(e.started_at!).getTime()) / 60000)
        }
        await tick()
      },
      canTime: true,
    }
  }, [])
  return <EngBoard api={api} />
}
