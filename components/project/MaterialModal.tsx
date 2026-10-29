'use client'

// ============================================================================
// MaterialModal — the P&L panel's Material row, opened (2026-10-29)
// ============================================================================
// Allowance vs spent at the top; the project's vendor bills below (parsed or
// typed, vendor / date / $, who entered or last edited it); drop a bill right
// here (the same InvoiceParser as /pm, locked to this project); or add one by
// hand. Rows edit in place and delete with a confirm. The ledger is the
// `invoices` table (124) via lib/project-expenses.
// ============================================================================

import { useEffect, useState } from 'react'
import { X, Pencil, Trash2, Plus, Upload } from 'lucide-react'
import InvoiceParser from '@/components/invoice-parser'
import { useConfirm } from '@/components/confirm-dialog'
import {
  createExpense,
  deleteExpense,
  findLikelyDuplicates,
  sumExpenses,
  updateExpense,
  type ProjectExpense,
} from '@/lib/project-expenses'

function money(n: number): string {
  const sign = n < 0 ? '−' : ''
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Today as a LOCAL calendar day (not toISOString — that's the UTC day). */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Draft {
  vendor: string
  date: string
  amount: string
  number: string
  note: string
}
const EMPTY: Draft = { vendor: '', date: today(), amount: '', number: '', note: '' }

export default function MaterialModal({
  orgId,
  userId,
  projectId,
  allowance,
  expenses,
  userNames,
  onChanged,
  onClose,
}: {
  orgId: string
  userId?: string | null
  projectId: string
  allowance: number
  expenses: ProjectExpense[]
  /** user id → name, for the entered/edited stamp. */
  userNames: Record<string, string>
  /** Reload the ledger (the page owns it — the panel reads the same list). */
  onChanged: () => void
  onClose: () => void
}) {
  const { confirm } = useConfirm()
  const [mode, setMode] = useState<'list' | 'add' | 'drop'>('list')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [dupeWarned, setDupeWarned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spent = sumExpenses(expenses)
  const left = allowance - spent

  useEffect(() => {
    setDupeWarned(false)
  }, [draft.vendor, draft.amount, draft.date])

  const amountNum = parseFloat(draft.amount.replace(/[$,]/g, ''))
  const draftOk = draft.vendor.trim() !== '' && Number.isFinite(amountNum) && amountNum !== 0
  const dupes =
    draftOk && !editing
      ? findLikelyDuplicates(expenses, { vendor_name: draft.vendor, amount: amountNum, invoice_date: draft.date || null })
      : []

  function startEdit(e: ProjectExpense) {
    setEditing(e.id)
    setMode('add')
    setDraft({
      vendor: e.vendor_name,
      date: e.invoice_date || '',
      amount: String(e.amount),
      number: e.invoice_number || '',
      note: e.note || '',
    })
  }

  async function save() {
    if (!draftOk || busy) return
    if (dupes.length > 0 && !dupeWarned) {
      setDupeWarned(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (editing) {
        await updateExpense(
          editing,
          { vendorName: draft.vendor, invoiceDate: draft.date || null, amount: amountNum, invoiceNumber: draft.number || null, note: draft.note || null },
          userId,
        )
      } else {
        await createExpense({
          orgId,
          projectId,
          vendorName: draft.vendor,
          invoiceDate: draft.date || null,
          amount: amountNum,
          invoiceNumber: draft.number || null,
          note: draft.note || null,
          source: 'manual',
          userId,
        })
      }
      setDraft(EMPTY)
      setEditing(null)
      setMode('list')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that bill.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(e: ProjectExpense) {
    const ok = await confirm({
      title: 'Delete this bill?',
      message: `${e.vendor_name} · ${money(e.amount)}${e.invoice_date ? ` · ${e.invoice_date}` : ''} comes off this job’s material spent.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteExpense(e.id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that bill.')
    }
  }

  const input =
    'w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB]'
  const label = 'text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider'

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white border border-[#E5E7EB] rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-[#F3F4F6]">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Material</div>
            <div className="flex items-baseline gap-4 mt-0.5 font-mono tabular-nums">
              <span className="text-[13px] text-[#6B7280]">
                Allowance <span className="text-[#111] font-semibold">{money(allowance)}</span>
              </span>
              <span className="text-[13px] text-[#6B7280]">
                Spent <span className="text-[#111] font-semibold">{money(spent)}</span>
              </span>
              <span className={`text-[13px] font-semibold ${left < 0 ? 'text-[#B91C1C]' : 'text-[#059669]'}`}>
                {left < 0 ? `${money(-left)} over` : `${money(left)} left`}
              </span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[#F3F4F6] flex items-center gap-2">
          <button
            onClick={() => {
              setMode('drop')
              setEditing(null)
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-lg border ${
              mode === 'drop' ? 'border-[#2563EB] text-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" /> Drop a bill
          </button>
          <button
            onClick={() => {
              setMode('add')
              setEditing(null)
              setDraft(EMPTY)
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-lg border ${
              mode === 'add' && !editing ? 'border-[#2563EB] text-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]'
            }`}
          >
            <Plus className="w-3.5 h-3.5" /> Add by hand
          </button>
          {mode !== 'list' && (
            <button
              onClick={() => {
                setMode('list')
                setEditing(null)
                setDraft(EMPTY)
              }}
              className="ml-auto text-[12px] text-[#6B7280] hover:text-[#111]"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="overflow-y-auto flex-1">
          {mode === 'drop' && (
            <div className="px-5 py-4 border-b border-[#F3F4F6]">
              <InvoiceParser
                projectId={projectId}
                onSaved={() => {
                  onChanged()
                }}
              />
            </div>
          )}

          {mode === 'add' && (
            <div className="px-5 py-4 border-b border-[#F3F4F6] space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className={label}>Vendor *</label>
                  <input autoFocus value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} className={input} placeholder="Rugby Architectural" />
                </div>
                <div>
                  <label className={label}>Date</label>
                  <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={input} />
                </div>
                <div>
                  <label className={label}>Amount *</label>
                  <input
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    className={`${input} font-mono`}
                    placeholder="1,240.50"
                  />
                </div>
                <div>
                  <label className={label}>Invoice #</label>
                  <input value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} className={input} />
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <label className={label}>Note</label>
                  <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={input} placeholder="Walnut for the back bar" />
                </div>
              </div>
              {dupes.length > 0 && dupeWarned && (
                <div className="p-2.5 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-[12px] text-[#92400E]">
                  Looks like a bill already here:{' '}
                  {dupes
                    .slice(0, 2)
                    .map((d) => `${d.vendor_name} ${money(d.amount)}${d.invoice_date ? ` (${d.invoice_date})` : ''}`)
                    .join(' · ')}
                  . Save again if it’s a different one.
                </div>
              )}
              {error && <div className="text-[12px] text-[#B91C1C]">{error}</div>}
              <button
                onClick={() => void save()}
                disabled={!draftOk || busy}
                className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {busy ? 'Saving…' : editing ? 'Save changes' : dupes.length > 0 && dupeWarned ? 'Save anyway' : 'Add bill'}
              </button>
            </div>
          )}

          {expenses.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-[#9CA3AF]">
              No bills on this job yet. Drop one or add it by hand — spent stays $0 until you do.
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[#9CA3AF] border-b border-[#F3F4F6]">
                  <th className="text-left font-semibold px-5 py-2">Vendor</th>
                  <th className="text-left font-semibold py-2">Date</th>
                  <th className="text-right font-semibold py-2">Amount</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {expenses.map((e) => {
                  const who = e.edited_by ? userNames[e.edited_by] : e.entered_by ? userNames[e.entered_by] : null
                  return (
                    <tr key={e.id} className="group">
                      <td className="px-5 py-2">
                        <div className="text-[#111] font-medium">
                          {e.vendor_name}
                          {e.invoice_number && <span className="text-[#9CA3AF] font-normal ml-1.5">#{e.invoice_number}</span>}
                          <span
                            className={`ml-1.5 text-[9px] uppercase tracking-wider px-1 py-px rounded ${
                              e.source === 'manual' ? 'bg-[#F3F4F6] text-[#6B7280]' : 'bg-[#EFF6FF] text-[#1E40AF]'
                            }`}
                          >
                            {e.source === 'manual' ? 'typed' : 'parsed'}
                          </span>
                        </div>
                        {(e.note || who) && (
                          <div className="text-[11px] text-[#9CA3AF]">
                            {e.note}
                            {e.note && who ? ' · ' : ''}
                            {who ? `${e.edited_by ? 'edited' : 'added'} by ${who}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-[#6B7280]">{e.invoice_date || '—'}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-[#111]">{money(e.amount)}</td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        <button onClick={() => startEdit(e)} aria-label="Edit" className="p-1 text-[#9CA3AF] hover:text-[#111]">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => void remove(e)} aria-label="Delete" className="p-1 text-[#9CA3AF] hover:text-[#DC2626]">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#E5E7EB] bg-[#F9FAFB]">
                  <td colSpan={2} className="px-5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                    Running total
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums font-semibold text-[#111]">{money(spent)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
