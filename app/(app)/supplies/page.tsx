'use client'

// ============================================================================
// /supplies — where we buy the stuff we buy rarely.
// ============================================================================
// Andrew, 2026-09-12: "some things we only buy every few months and we have to
// dig around to figure out where to get it. Keep it simple for now, filters
// later."
//
// ⛔ NO CATEGORIES, NO FILTERS IN V1 — Andrew's explicit call, not an
// oversight. A category invented now would be guessed and then lived with.
// The search box covers every field instead (see `supplyMatches`), which is
// enough at this size. WHERE FILTERS WOULD GO: a chip row under the search
// box, reading a `category` column added in a later migration — the list
// below already renders from a filtered array, so it's a one-line change.
//
// ⛔ NOT A PRICED CATALOG. Nothing here feeds pricing; the rate book owns
// anything that does. See the header of migration 102 for why that boundary
// matters.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Plus, Search } from 'lucide-react'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import {
  createSupply,
  loadSupplies,
  supplyMatches,
  updateSupply,
  type SupplyItem,
} from '@/lib/supplies'

export default function SuppliesPage() {
  const { org } = useAuth()
  const [items, setItems] = useState<SupplyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!org?.id) return
    const res = await loadSupplies(org.id)
    setItems(res.items)
    setMissing(res.missing)
    setError(res.error)
    setLoading(false)
  }, [org?.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = useMemo(
    () =>
      items
        .filter((i) => (showArchived ? true : i.active))
        .filter((i) => supplyMatches(i, query)),
    [items, query, showArchived],
  )

  const archivedCount = items.filter((i) => !i.active).length

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PlanGate requires="projects">
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="p-6 max-w-[1000px] mx-auto">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-[20px] font-semibold text-[#111]">Supplies</h1>
            {!adding && !missing && (
              <button
                onClick={() => {
                  setAdding(true)
                  setEditingId(null)
                }}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8]"
              >
                <Plus className="w-3.5 h-3.5" /> Add a supply
              </button>
            )}
          </div>
          <p className="text-xs text-[#6B7280] mb-5">
            Where to buy the things you only order every few months. Not a price
            list — anything that prices a job lives in the rate book.
          </p>

          {missing && (
            <div className="mb-4 text-[12px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2">
              Supplies needs migration <code>102</code>. Until it runs there’s
              nowhere to save anything.
            </div>
          )}

          {error && (
            <div className="mb-4 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {!missing && (
            <>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search name, vendor, phone, notes…"
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                {archivedCount > 0 && (
                  <button
                    onClick={() => setShowArchived((v) => !v)}
                    className={`px-2.5 py-1.5 rounded-lg border text-[11.5px] ${
                      showArchived
                        ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]'
                        : 'border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {showArchived ? 'Hiding nothing' : `Show archived (${archivedCount})`}
                  </button>
                )}
              </div>

              {adding && (
                <SupplyForm
                  busy={busy}
                  onCancel={() => setAdding(false)}
                  onSave={async (input) => {
                    await run(() => createSupply(org!.id, input))
                    setAdding(false)
                  }}
                />
              )}

              <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                {loading ? (
                  <div className="px-4 py-10 text-center text-[13px] text-[#9CA3AF] italic">
                    Loading supplies…
                  </div>
                ) : visible.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <div className="text-sm text-[#374151] font-medium">
                      {items.length === 0
                        ? 'Nothing here yet.'
                        : 'Nothing matches that.'}
                    </div>
                    <div className="text-xs text-[#9CA3AF] mt-1">
                      {items.length === 0
                        ? 'Add the things you always have to go looking for — sandpaper, a specific slide, the glass place.'
                        : 'The search looks at names, vendors, phone numbers and notes.'}
                    </div>
                  </div>
                ) : (
                  visible.map((item, i) =>
                    editingId === item.id ? (
                      <div key={item.id} className={i === 0 ? '' : 'border-t border-[#F3F4F6]'}>
                        <SupplyForm
                          initial={item}
                          busy={busy}
                          onCancel={() => setEditingId(null)}
                          onSave={async (input) => {
                            await run(() => updateSupply(item.id, input))
                            setEditingId(null)
                          }}
                        />
                      </div>
                    ) : (
                      <SupplyRow
                        key={item.id}
                        item={item}
                        first={i === 0}
                        busy={busy}
                        onEdit={() => {
                          setEditingId(item.id)
                          setAdding(false)
                        }}
                        onToggleArchive={() =>
                          run(() => updateSupply(item.id, { active: !item.active }))
                        }
                      />
                    ),
                  )
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </PlanGate>
  )
}

// ── One row ─────────────────────────────────────────────────────────────────

function SupplyRow({
  item,
  first,
  busy,
  onEdit,
  onToggleArchive,
}: {
  item: SupplyItem
  first: boolean
  busy: boolean
  onEdit: () => void
  onToggleArchive: () => void
}) {
  return (
    <div
      className={`px-4 py-3 flex items-start gap-3 hover:bg-[#FAFAFA] transition-colors ${
        first ? '' : 'border-t border-[#F3F4F6]'
      } ${item.active ? '' : 'opacity-60'}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {/* ⛔ `item.url` has been through the allowlist in lib/task-links on
              the way out of the database — see lib/supplies.toItem. Don't
              build an href from a raw column here. */}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] font-medium text-[#2563EB] hover:underline inline-flex items-center gap-1"
            >
              {item.name}
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>
          ) : (
            <span className="text-[14px] font-medium text-[#111]">{item.name}</span>
          )}
          {!item.active && (
            <span className="text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280]">
              Archived
            </span>
          )}
        </div>
        {(item.vendor || item.vendorInfo) && (
          <div className="text-[12.5px] text-[#374151] mt-0.5">
            {item.vendor}
            {item.vendor && item.vendorInfo ? ' · ' : ''}
            <span className="text-[#6B7280]">{item.vendorInfo}</span>
          </div>
        )}
        {item.notes && (
          <div className="text-[12px] text-[#9CA3AF] mt-0.5 leading-snug">{item.notes}</div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onEdit}
          disabled={busy}
          className="text-[11.5px] text-[#2563EB] hover:text-[#1D4ED8] font-medium disabled:opacity-50"
        >
          Edit
        </button>
        <button
          onClick={onToggleArchive}
          disabled={busy}
          title={
            item.active
              ? 'Hide it from the list. Nothing is deleted.'
              : 'Put it back in the list.'
          }
          className="text-[11.5px] text-[#6B7280] hover:text-[#111] disabled:opacity-50"
        >
          {item.active ? 'Archive' : 'Restore'}
        </button>
      </div>
    </div>
  )
}

// ── Add / edit ──────────────────────────────────────────────────────────────

function SupplyForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial?: SupplyItem
  busy: boolean
  onSave: (input: {
    name: string
    url: string
    vendor: string
    vendorInfo: string
    notes: string
  }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [vendor, setVendor] = useState(initial?.vendor ?? '')
  const [vendorInfo, setVendorInfo] = useState(initial?.vendorInfo ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const field =
    'w-full px-2.5 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]'

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 mb-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="sm:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
            What is it
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="PSA sandpaper rolls, 120 grit"
            className={field}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
            Vendor
          </label>
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="Klingspor"
            className={field}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
            Link
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="klingspor.com/…"
            className={field}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
            Phone, rep, account #
          </label>
          <input
            value={vendorInfo}
            onChange={(e) => setVendorInfo(e.target.value)}
            placeholder="(800) 555-0199 · ask for Dave · acct 44812"
            className={field}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
            Notes
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Min order 4 rolls. Takes about a week."
            className={field}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          disabled={busy || !name.trim()}
          onClick={() => void onSave({ name, url, vendor, vendorInfo, notes })}
          className="px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {busy ? 'Saving…' : initial ? 'Save' : 'Add supply'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#374151] text-xs hover:bg-[#F9FAFB]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
