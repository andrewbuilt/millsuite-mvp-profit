// ============================================================================
// lib/capacity-math.ts — month-allocation department hours, made consistent
// ============================================================================
// ⛔ THE BUG (Andrew, 2026-11-04: "4 of 5 departments overbooked but the month
// shows 95%?"). A split job's month slices each carried the WHOLE job's
// department_hours while hours_allocated was the slice: Kinser split in three
// = 315h per month but 946h of dept hours on each slice. The month line reads
// hours_allocated (right); the dept rows read department_hours (counted the
// job once per slice). Built, Nov: depts summed to 2848h against a 1306h
// month. 18 of 32 live rows were like that (the old even split copied the
// map verbatim).
//
// RULE: a row's hours_allocated is the truth for that month; its dept map is
// only the MIX. sliceDeptHours scales the map to sum to hours_allocated, so a
// month's dept rows always add up to its booked line. New writes are
// consistent at the source (handleSplit / remove-split / refresh); this also
// makes the existing rows read right without touching prod data.
// ============================================================================

export type DeptHours = Record<string, number>

export function sumDeptHours(m: DeptHours | null | undefined): number {
  return Object.values(m || {}).reduce((a, b) => a + (Number(b) || 0), 0)
}

/** The dept mix scaled so it sums to the row's hours. Pure. */
export function sliceDeptHours(
  alloc: { hours_allocated: number; department_hours: DeptHours | null | undefined },
): DeptHours {
  const map = alloc.department_hours || {}
  const total = sumDeptHours(map)
  const hrs = Number(alloc.hours_allocated) || 0
  if (total <= 0) return {}
  if (Math.abs(total - hrs) < 0.5) return { ...map }
  const k = hrs / total
  const out: DeptHours = {}
  for (const [id, h] of Object.entries(map)) out[id] = (Number(h) || 0) * k
  return out
}

/** Scale a whole-job dept map down to a slice of `hours`. Pure. */
export function scaleDeptHours(map: DeptHours | null | undefined, hours: number): DeptHours | null {
  const total = sumDeptHours(map)
  if (!map || total <= 0) return null
  const k = hours / total
  const out: DeptHours = {}
  for (const [id, h] of Object.entries(map)) out[id] = Math.round((Number(h) || 0) * k * 100) / 100
  return out
}

/** Merge slices back into one row's dept map (each slice scaled first). Pure. */
export function mergeDeptHours(
  slices: Array<{ hours_allocated: number; department_hours: DeptHours | null | undefined }>,
): DeptHours | null {
  const out: DeptHours = {}
  for (const s of slices) {
    for (const [id, h] of Object.entries(sliceDeptHours(s))) out[id] = (out[id] || 0) + h
  }
  return Object.keys(out).length ? out : null
}
