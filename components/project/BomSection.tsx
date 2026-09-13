'use client'

// ============================================================================
// BomSection — the purchasing list, drafted from the approved drawings.
// ============================================================================
// Andrew, 2026-09-12: lives ON THE PROJECT · COUNTS ONLY · editable and saved.
//
// ⛔ THE TRUST POSTURE IS THE FEATURE. A parsed count is a machine's guess at
// a number someone is about to SPEND MONEY ON. So:
//   · parsed rows say they're estimates until a person ticks them off
//   · a re-parse never edits a corrected row — it flags the difference and
//     leaves the human's number alone (lib/bom-merge, and two columns in
//     migration 103)
//   · the empty parse is reported as a failure, not as an empty list
// Every one of those is the difference between "the list was wrong" and "the
// list was wrong and nobody could tell".
//
// ⛔ NOT A CUT LIST. Counts only — no part sizes. See migration 103.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ClipboardCopy, Check, Plus, Upload, X } from 'lucide-react'
import {
  addBomItem,
  applyParsedBom,
  bomToText,
  deleteBomItem,
  loadBom,
  updateBomItem,
  type BomRow,
} from '@/lib/bom'
import {
  BOM_CATEGORY_LABEL,
  BOM_CATEGORY_ORDER,
  hasCountDisagreement,
  type BomCategory,
} from '@/lib/bom-merge'
import { parsePdfForBom } from '@/lib/pdf-parser'
import { loadSupplies, type SupplyItem } from '@/lib/supplies'

export default function BomSection({
  orgId,
  projectId,
  projectName,
}: {
  orgId: string | undefined
  projectId: string
  projectName: string
}) {
  const [rows, setRows] = useState<BomRow[]>([])
  const [supplies, setSupplies] = useState<SupplyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const res = await loadBom(projectId)
    setRows(res.rows)
    setMissing(res.missing)
    setError(res.error)
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // For the vendor tie-in. Failure is silent: a missing supplies table must
  // not stop the purchasing list from loading.
  useEffect(() => {
    if (!orgId) return
    void loadSupplies(orgId).then((r) => setSupplies(r.items)).catch(() => {})
  }, [orgId])

  /** Returns false when the write failed, so a caller holding local input
   *  state knows to put it back. */
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      return false
    } finally {
      // ⛔ ALWAYS REFRESH, EVEN ON FAILURE. `refresh()` used to sit after
      // `fn()` inside the try, so a throw skipped it — and a partly-applied
      // parse (inserts landed, a flag then failed) left new rows in the
      // database and off the screen. The natural next move is to re-parse,
      // which is how a failure became a duplicate list.
      await refresh()
      setBusy(false)
    }
  }

  async function handleFile(file: File) {
    if (!orgId) return
    setParsing(true)
    setError(null)
    setResult(null)
    try {
      const parsed = await parsePdfForBom(file, orgId)
      if (parsed.error) {
        // ⚠️ The cap is a different thing from a failure — waiting fixes it,
        // and re-dropping the file doesn't. Saying "parser error" to someone
        // who has simply used today's allowance sends them debugging.
        setError(
          parsed.rateLimited
            ? `${parsed.error} — this resets tomorrow; the drawings don't need re-uploading.`
            : parsed.error,
        )
        return
      }
      // ⛔ No `rows` argument any more: applyParsedBom re-reads the list from
      // the database. A parse can take minutes, and the copy this component
      // is holding may be several edits out of date by the time it lands.
      const outcome = await applyParsedBom(orgId, projectId, parsed.items)
      // ⛔ SAY WHAT CHANGED. Silently appending thirty rows to a list someone
      // already worked through is alarming, and a re-parse that changed
      // nothing looks broken unless it says so.
      const bits: string[] = []
      if (outcome.added) bits.push(`${outcome.added} added`)
      if (outcome.flagged) bits.push(`${outcome.flagged} count${outcome.flagged === 1 ? '' : 's'} changed`)
      if (outcome.unchanged) bits.push(`${outcome.unchanged} unchanged`)
      setResult(bits.length ? bits.join(' · ') : 'Nothing new found.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that set.')
    } finally {
      // ⛔ REFRESH EVEN ON FAILURE. applyParsedBom inserts and then flags; if
      // the flags throw, the inserts are already in the database. Leaving the
      // screen stale hides them, and the obvious response — parse again —
      // used to duplicate the lot.
      await refresh()
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<BomCategory, BomRow[]>()
    for (const r of rows) {
      const list = m.get(r.category)
      if (list) list.push(r)
      else m.set(r.category, [r])
    }
    return m
  }, [rows])

  const flaggedCount = rows.filter(hasCountDisagreement).length
  const uncheckedParsed = rows.filter((r) => r.source === 'parsed' && !r.checkedOff).length

  /**
   * Vendor tie-in — deliberately the cheap version (Andrew: "no new schema,
   * display only"). A simple contains match in either direction, so "Blum
   * 21in slide" finds a supply called "Blum slides" and vice versa.
   * ⚠️ Not a link, not a foreign key, not a migration. If this ever needs to
   * be reliable it needs a real relation, and that's a different decision.
   */
  const supplyFor = useCallback(
    (row: BomRow): SupplyItem | null => {
      if (row.category !== 'hardware' && row.category !== 'other') return null
      const name = row.name.toLowerCase()
      // ⛔ BOTH SIDES NEED A LENGTH FLOOR. The guard was on the supply name
      // only, so a short ROW name matched anything containing it — a fastener
      // called "Nut" matched the supply "Walnut edge banding" and rendered
      // that vendor's link under it. Word boundaries stop the substring
      // matching mid-word in either direction.
      if (name.length <= 3) return null
      const bounded = (haystack: string, needle: string) =>
        new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack)
      return (
        supplies.find((s) => {
          if (!s.active) return false
          const sn = s.name.toLowerCase()
          if (sn.length <= 3) return false
          return bounded(name, sn) || bounded(sn, name)
        }) ?? null
      )
    },
    [supplies],
  )

  if (missing) {
    return (
      <section className="bg-white border border-[#E5E7EB] rounded-xl p-4">
        <div className="text-[13px] font-semibold text-[#111] mb-1">Purchasing list</div>
        <div className="text-[12px] text-[#92400E]">
          Needs migration <code>103</code>.
        </div>
      </section>
    )
  }

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#F3F4F6] flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[#111]">Purchasing list</div>
          <div className="text-[11px] text-[#9CA3AF] leading-tight">
            What to buy for this job. Counts only — not a cut list.
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {rows.length > 0 && (
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(bomToText(rows, projectName))
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="inline-flex items-center gap-1 text-[11.5px] text-[#6B7280] hover:text-[#111]"
            >
              <ClipboardCopy className="w-3.5 h-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          <button
            onClick={() => setAdding((v) => !v)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11.5px] text-[#2563EB] hover:text-[#1D4ED8] font-medium disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={parsing || busy || !orgId}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#2563EB] text-white text-[11.5px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {parsing ? 'Reading…' : rows.length > 0 ? 'Re-parse drawings' : 'Parse drawings'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
          {error}
        </div>
      )}
      {result && (
        <div className="mx-4 mt-3 text-[12px] text-[#065F46] bg-[#ECFDF5] border border-[#A7F3D0] rounded-md px-3 py-2">
          {result}
        </div>
      )}

      {/* ⛔ THE TRUST LINE. Parsed counts are a machine's guess at something
          about to be bought — say so until a human has been through it. */}
      {uncheckedParsed > 0 && (
        <div className="mx-4 mt-3 text-[11.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2 leading-snug">
          {uncheckedParsed} parsed {uncheckedParsed === 1 ? 'line hasn’t' : 'lines haven’t'} been
          checked. These are the parser’s counts, not verified ones — tick each
          off as you confirm it against the drawings.
        </div>
      )}
      {flaggedCount > 0 && (
        <div className="mx-4 mt-3 text-[11.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          {flaggedCount} {flaggedCount === 1 ? 'line' : 'lines'} where the latest parse
          disagrees with your number. Yours was kept.
        </div>
      )}

      {adding && (
        <AddRow
          busy={busy}
          onCancel={() => setAdding(false)}
          onAdd={async (input) => {
            await run(() => addBomItem(orgId!, projectId, input))
            setAdding(false)
          }}
        />
      )}

      {loading ? (
        <div className="px-4 py-8 text-[12.5px] text-[#9CA3AF] italic">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <div className="text-[13px] text-[#374151] font-medium">No list yet.</div>
          <div className="text-[11.5px] text-[#9CA3AF] mt-1 max-w-md mx-auto leading-snug">
            Drop the approved drawing set and the parser drafts what to order —
            sheet goods, hardware, drawer boxes. You correct it; your edits
            survive a re-parse.
          </div>
        </div>
      ) : (
        BOM_CATEGORY_ORDER.filter((c) => grouped.has(c)).map((cat) => (
          <div key={cat}>
            <div className="px-4 py-1.5 bg-[#FAFAFA] border-y border-[#F3F4F6] text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
              {BOM_CATEGORY_LABEL[cat]}
            </div>
            {(grouped.get(cat) || []).map((row) => (
              <BomLine
                key={row.id}
                row={row}
                supply={supplyFor(row)}
                busy={busy}
                onPatch={(patch) => run(() => updateBomItem(row.id, patch))}
                onDelete={() => run(() => deleteBomItem(row.id))}
              />
            ))}
          </div>
        ))
      )}
    </section>
  )
}

// ── One line ────────────────────────────────────────────────────────────────

function BomLine({
  row,
  supply,
  busy,
  onPatch,
  onDelete,
}: {
  row: BomRow
  supply: SupplyItem | null
  busy: boolean
  onPatch: (patch: Parameters<typeof updateBomItem>[1]) => Promise<boolean>
  onDelete: () => void
}) {
  const [qty, setQty] = useState(String(row.qty))
  useEffect(() => setQty(String(row.qty)), [row.qty])
  const disagrees = hasCountDisagreement(row)

  return (
    <div
      className={`px-4 py-2 border-b border-[#F3F4F6] flex items-start gap-3 ${
        row.checkedOff ? 'bg-[#F9FAFB]' : ''
      }`}
    >
      <button
        onClick={() => onPatch({ checkedOff: !row.checkedOff })}
        disabled={busy}
        title={row.checkedOff ? 'Not checked yet' : 'I have confirmed this count'}
        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
          row.checkedOff
            ? 'bg-[#059669] border-[#059669] text-white'
            : 'border-[#D1D5DB] hover:border-[#059669]'
        }`}
      >
        {row.checkedOff && <Check className="w-3 h-3" />}
      </button>

      <input
        value={qty}
        onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={async () => {
          // ⛔ BLANK IS A REVERT, NOT A ZERO. `Number('')` is 0, so clearing
          // the cell and tabbing away used to save "don't buy this".
          if (qty.trim() === '') {
            setQty(String(row.qty))
            return
          }
          const n = Number(qty)
          if (!Number.isFinite(n) || n === row.qty) {
            setQty(String(row.qty))
            return
          }
          // ⛔ PUT THE OLD NUMBER BACK IF THE SAVE FAILED. Without this the
          // input kept showing what was typed while the database held the old
          // value — and the copy-to-PO button reads the database, so the
          // screen and the thing sent to the supplier disagreed silently.
          const ok = await onPatch({ qty: n })
          if (!ok) setQty(String(row.qty))
        }}
        disabled={busy}
        className="w-14 px-1.5 py-0.5 text-[12.5px] font-mono text-right border border-[#E5E7EB] rounded focus:outline-none focus:border-[#2563EB] flex-shrink-0"
      />
      <span className="text-[11px] text-[#9CA3AF] w-10 flex-shrink-0 mt-1">{row.unit}</span>

      <div className="min-w-0 flex-1">
        <div className={`text-[12.5px] ${row.checkedOff ? 'text-[#6B7280]' : 'text-[#111]'}`}>
          {row.name}
          {row.spec && <span className="text-[#9CA3AF]"> · {row.spec}</span>}
          {row.source === 'manual' && (
            <span className="ml-1.5 text-[9.5px] uppercase tracking-wider text-[#6B7280] bg-[#F3F4F6] px-1 py-0.5 rounded">
              added
            </span>
          )}
        </div>
        {/* ⛔ THE DISAGREEMENT IS SHOWN, NEVER APPLIED. Accepting it is a
            click, because the shop's number is usually the right one — they
            counted it on site. */}
        {disagrees && (
          <div className="text-[11px] text-[#92400E] mt-0.5">
            Latest parse says {row.parsedQty}.{' '}
            <button
              onClick={() => onPatch({ acceptParsedQty: row.parsedQty! })}
              disabled={busy}
              className="underline hover:text-[#78350F]"
            >
              Use it
            </button>
          </div>
        )}
        {row.notes && <div className="text-[11px] text-[#9CA3AF] mt-0.5">{row.notes}</div>}
        {supply?.url && (
          <a
            href={supply.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[#2563EB] hover:underline mt-0.5 inline-block"
          >
            {supply.vendor || supply.name} →
          </a>
        )}
      </div>

      <button
        onClick={onDelete}
        disabled={busy}
        title="Remove this line"
        className="text-[#D1D5DB] hover:text-[#DC2626] flex-shrink-0 mt-0.5"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Add ─────────────────────────────────────────────────────────────────────

function AddRow({
  busy,
  onAdd,
  onCancel,
}: {
  busy: boolean
  onAdd: (input: {
    category: BomCategory
    name: string
    spec: string | null
    qty: number
    unit: string
  }) => Promise<void>
  onCancel: () => void
}) {
  const [category, setCategory] = useState<BomCategory>('hardware')
  const [name, setName] = useState('')
  const [spec, setSpec] = useState('')
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState('ea')

  const field =
    'px-2 py-1 text-[12.5px] border border-[#E5E7EB] rounded focus:outline-none focus:border-[#2563EB]'

  return (
    <div className="px-4 py-3 bg-[#F9FAFB] border-b border-[#F3F4F6] flex items-end gap-2 flex-wrap">
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as BomCategory)}
        className={field}
      >
        {BOM_CATEGORY_ORDER.map((c) => (
          <option key={c} value={c}>
            {BOM_CATEGORY_LABEL[c]}
          </option>
        ))}
      </select>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="What to order"
        className={`${field} flex-1 min-w-[160px]`}
      />
      <input
        value={spec}
        onChange={(e) => setSpec(e.target.value)}
        placeholder="Spec"
        className={`${field} w-28`}
      />
      <input
        value={qty}
        onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
        className={`${field} w-14 text-right font-mono`}
      />
      <input
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        className={`${field} w-14`}
      />
      <button
        disabled={busy || !name.trim()}
        onClick={() =>
          void onAdd({
            category,
            name,
            spec: spec.trim() || null,
            qty: Number(qty) || 0,
            unit: unit || 'ea',
          })
        }
        className="px-2.5 py-1 rounded bg-[#2563EB] text-white text-[11.5px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
      >
        Add
      </button>
      <button onClick={onCancel} className="px-2 py-1 text-[11.5px] text-[#6B7280] hover:text-[#111]">
        Cancel
      </button>
    </div>
  )
}
