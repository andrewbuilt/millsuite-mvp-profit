'use client'

// ============================================================================
// RecordPaymentModal — log a manual payment against an invoice
// ============================================================================
// Two modes:
//   - 'create' — fresh payment row. Amount defaults to balance due so
//     the common "client paid the full remaining balance" case is one
//     keystroke away.
//   - 'edit' — patch an existing payment. Caller passes the payment
//     row; the modal seeds from it and calls updateInvoicePayment on
//     save.
//
// Payment-method enum mirrors the schema CHECK constraint
// (check / ach / card / cash / other). Reference + notes are
// freeform strings, both optional.
// ============================================================================

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  recordInvoicePayment,
  updateInvoicePayment,
  type Invoice,
  type InvoicePayment,
} from '@/lib/invoices'

const METHODS: { value: NonNullable<InvoicePayment['payment_method']>; label: string }[] = [
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
]

export default function RecordPaymentModal({
  invoice,
  payment,
  onClose,
  onSaved,
}: {
  invoice: Invoice
  /** Pass an existing payment to enter edit mode; omit for create. */
  payment?: InvoicePayment | null
  onClose: () => void
  onSaved: (updated: Invoice) => void
}) {
  const isEdit = Boolean(payment)
  const balanceDue = +(invoice.total - invoice.amount_received).toFixed(2)
  const today = new Date().toISOString().slice(0, 10)

  const [amount, setAmount] = useState<string>(
    payment ? String(payment.amount) : balanceDue > 0 ? String(balanceDue) : '0',
  )
  const [paymentDate, setPaymentDate] = useState<string>(
    payment?.payment_date ?? today,
  )
  const [method, setMethod] = useState<NonNullable<InvoicePayment['payment_method']>>(
    payment?.payment_method ?? 'check',
  )
  const [reference, setReference] = useState<string>(payment?.reference ?? '')
  const [notes, setNotes] = useState<string>(payment?.notes ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
  }, [amount, paymentDate, method, reference, notes])

  async function handleSubmit() {
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      setError('Amount must be greater than 0')
      return
    }
    if (!paymentDate) {
      setError('Payment date is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updated = isEdit && payment
        ? await updateInvoicePayment(payment.id, {
            amount: amountNum,
            payment_date: paymentDate,
            payment_method: method,
            reference: reference.trim() || null,
            notes: notes.trim() || null,
          })
        : await recordInvoicePayment({
            invoice_id: invoice.id,
            amount: amountNum,
            payment_date: paymentDate,
            payment_method: method,
            reference: reference.trim() || null,
            notes: notes.trim() || null,
          })
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-[#111]">
              {isEdit ? 'Edit payment' : 'Record payment'}
            </h3>
            <p className="text-[11.5px] text-[#9CA3AF] mt-0.5 font-mono">
              {invoice.invoice_number} · Balance due ${balanceDue.toFixed(2)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-[#111] p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          <Field label="Amount">
            <div className="flex items-center gap-1">
              <span className="text-[14px] text-[#6B7280]">$</span>
              <input
                type="number"
                min={0}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-[13px] font-mono tabular-nums bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>
            {balanceDue > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(balanceDue))}
                className="mt-1 text-[11px] text-[#2563EB] hover:underline"
              >
                Set to balance due (${balanceDue.toFixed(2)})
              </button>
            )}
          </Field>

          <Field label="Payment date">
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Method">
            <select
              value={method ?? 'check'}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              className={inputClass}
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Reference (optional)">
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Check #, ACH ref, etc."
              className={inputClass}
            />
          </Field>

          <Field label="Notes (internal, optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </Field>

          {error && (
            <div className="px-3 py-2 bg-[#FEE2E2] border border-[#FECACA] rounded-lg text-[12px] text-[#991B1B]">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-[12.5px] text-[#374151] hover:bg-[#F3F4F6] rounded-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-3 py-1.5 text-[12.5px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Record payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputClass =
  'w-full px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
        {label}
      </div>
      {children}
    </label>
  )
}
