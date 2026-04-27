// ============================================================================
// lib/reparse-diff.ts — diff a re-parse against the current project scope
// ============================================================================
// Pure — no DB calls. Caller loads the current scope (estimate_lines joined
// with subprojects for room names) and the new ParsedScopeItem[] from
// the re-run parser, hands both to computeReparseDiff, and renders the
// review-and-apply modal from the result.
//
// Match heuristic (intentionally lenient — the modal is the safety net):
//   1. Same room (case-insensitive, trimmed, whitespace-collapsed)
//   2. Description containment in either direction (substring match)
//      OR exact item_type match when both sides supply it
// Items that match get checked field-by-field for changes; unmatched
// current lines become "removed" candidates; unmatched parsed items
// become "new" candidates.
// ============================================================================

import type { ParsedScopeItem } from './pdf-parser'

export interface CurrentScopeLine {
  lineId: string
  room: string
  description: string
  quantity: number | null
  unit: string | null
  item_type: string | null
  finishSpecs: any | null
  /** Subproject id — needed when applying changes (we update the
   *  estimate_lines row directly via lineId, but the subproject id
   *  comes in handy for future moves between rooms). */
  subprojectId: string
}

export interface ChangedField {
  field: string
  from: any
  to: any
}

export interface ReparseDiff {
  /** Parsed items that don't match any current line. Become new
   *  estimate_lines on apply. */
  newItems: ParsedScopeItem[]
  /** Current lines that match a parsed item with at least one field
   *  changed. Apply updates the diffed fields only. */
  changedItems: Array<{
    currentLineId: string
    current: {
      description: string
      quantity: number | null
      unit: string | null
      room: string
      finishSpecs: any | null
    }
    parsed: ParsedScopeItem
    fieldDiffs: ChangedField[]
  }>
  /** Current lines that don't match any parsed item. Apply deletes
   *  the row. */
  removedItems: Array<{
    currentLineId: string
    description: string
    room: string
  }>
  /** Rooms in the parse not yet in the project — apply will create
   *  new subprojects for these. */
  newRooms: string[]
  /** Rooms in the project not in the parse — informational only;
   *  removed-items handling drops their lines but the subproject
   *  stays unless empty. */
  removedRooms: string[]
}

function norm(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Containment-based description similarity. Returns true when either
 *  string contains the other. Cheap and good enough for parser-vs-
 *  human-edited descriptions where small wording variations are
 *  common ("Range hood cabinet" vs "Range hood cab"). */
function descMatch(a: string, b: string): boolean {
  const an = norm(a)
  const bn = norm(b)
  if (!an || !bn) return false
  if (an === bn) return true
  // Substring containment in either direction.
  if (an.length >= 4 && bn.includes(an)) return true
  if (bn.length >= 4 && an.includes(bn)) return true
  return false
}

function fieldEquals(a: any, b: any): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/** Build the per-field diff between a current line and a parsed item.
 *  Only fields the apply path can actually update are compared. */
function diffFields(
  current: CurrentScopeLine,
  parsed: ParsedScopeItem,
): ChangedField[] {
  const out: ChangedField[] = []
  const parsedQty = parsed.linear_feet ?? parsed.quantity ?? null
  const parsedUnit = parsed.linear_feet != null ? 'lf' : 'each'
  if (!fieldEquals(current.description, parsed.name)) {
    out.push({ field: 'description', from: current.description, to: parsed.name })
  }
  if (!fieldEquals(current.quantity, parsedQty)) {
    out.push({ field: 'quantity', from: current.quantity, to: parsedQty })
  }
  if (!fieldEquals(current.unit, parsedUnit)) {
    out.push({ field: 'unit', from: current.unit, to: parsedUnit })
  }
  if (!fieldEquals(norm(current.room), norm(parsed.room || ''))) {
    out.push({ field: 'room', from: current.room, to: parsed.room })
  }
  if (
    parsed.finish_specs &&
    !fieldEquals(current.finishSpecs, parsed.finish_specs)
  ) {
    out.push({
      field: 'finish_specs',
      from: current.finishSpecs,
      to: parsed.finish_specs,
    })
  }
  return out
}

export function computeReparseDiff(input: {
  currentScope: CurrentScopeLine[]
  parsedItems: ParsedScopeItem[]
}): ReparseDiff {
  const { currentScope, parsedItems } = input

  // Track which current lines have been claimed by a match so we
  // don't double-attribute the same line to two parsed items.
  const matchedLineIds = new Set<string>()

  const changedItems: ReparseDiff['changedItems'] = []
  const newItems: ParsedScopeItem[] = []

  for (const it of parsedItems) {
    let match: CurrentScopeLine | null = null
    for (const line of currentScope) {
      if (matchedLineIds.has(line.lineId)) continue
      if (norm(line.room) !== norm(it.room || '')) continue
      const sameType =
        it.item_type && line.item_type
          ? norm(it.item_type) === norm(line.item_type)
          : false
      if (sameType || descMatch(line.description, it.name)) {
        match = line
        break
      }
    }
    if (match) {
      matchedLineIds.add(match.lineId)
      const diffs = diffFields(match, it)
      if (diffs.length > 0) {
        changedItems.push({
          currentLineId: match.lineId,
          current: {
            description: match.description,
            quantity: match.quantity,
            unit: match.unit,
            room: match.room,
            finishSpecs: match.finishSpecs,
          },
          parsed: it,
          fieldDiffs: diffs,
        })
      }
      // No-diff matches drop out — same item, no change to surface.
    } else {
      newItems.push(it)
    }
  }

  const removedItems: ReparseDiff['removedItems'] = currentScope
    .filter((l) => !matchedLineIds.has(l.lineId))
    .map((l) => ({
      currentLineId: l.lineId,
      description: l.description,
      room: l.room,
    }))

  // Rooms — new = in parse, not in current; removed = inverse.
  const currentRooms = new Set(currentScope.map((l) => norm(l.room)))
  const parsedRoomDisplayByNorm = new Map<string, string>()
  for (const it of parsedItems) {
    const n = norm(it.room || '')
    if (n && !parsedRoomDisplayByNorm.has(n)) {
      parsedRoomDisplayByNorm.set(n, it.room || '')
    }
  }
  const newRooms: string[] = []
  for (const [n, display] of Array.from(parsedRoomDisplayByNorm.entries())) {
    if (!currentRooms.has(n)) newRooms.push(display)
  }

  const parsedRoomsNorm = new Set(parsedRoomDisplayByNorm.keys())
  const currentRoomDisplayByNorm = new Map<string, string>()
  for (const l of currentScope) {
    const n = norm(l.room)
    if (n && !currentRoomDisplayByNorm.has(n)) {
      currentRoomDisplayByNorm.set(n, l.room)
    }
  }
  const removedRooms: string[] = []
  for (const [n, display] of Array.from(currentRoomDisplayByNorm.entries())) {
    if (!parsedRoomsNorm.has(n)) removedRooms.push(display)
  }

  return {
    newItems,
    changedItems,
    removedItems,
    newRooms,
    removedRooms,
  }
}
