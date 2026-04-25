'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import { AlertTriangle, AlertCircle } from 'lucide-react'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
}

interface AlertOptions {
  title: string
  message: string
  okLabel?: string
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** Single-button OK modal — drop-in replacement for window.alert that
   *  matches the rest of the in-app modal styling. Resolves when the user
   *  dismisses; intentionally async so error-toast call sites can `await`
   *  before the parent does its next thing if it cares. */
  alert: (options: AlertOptions) => Promise<void>
}

const ConfirmContext = createContext<ConfirmContextType>({
  confirm: async () => false,
  alert: async () => {},
})

export function useConfirm() {
  return useContext(ConfirmContext)
}

type Dialog =
  | ({ kind: 'confirm' } & ConfirmOptions & { resolve: (v: boolean) => void })
  | ({ kind: 'alert' } & AlertOptions & { resolve: () => void })

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialog({ kind: 'confirm', ...options, resolve })
    })
  }, [])

  const alertModal = useCallback((options: AlertOptions): Promise<void> => {
    return new Promise((resolve) => {
      setDialog({ kind: 'alert', ...options, resolve })
    })
  }, [])

  function handleConfirm() {
    if (dialog?.kind === 'confirm') dialog.resolve(true)
    setDialog(null)
  }

  function handleCancel() {
    if (dialog?.kind === 'confirm') dialog.resolve(false)
    if (dialog?.kind === 'alert') dialog.resolve()
    setDialog(null)
  }

  function handleOk() {
    if (dialog?.kind === 'alert') dialog.resolve()
    setDialog(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm, alert: alertModal }}>
      {children}

      {dialog && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/30 z-[100]" onClick={handleCancel} />

          {/* Dialog */}
          <div className="fixed inset-0 flex items-center justify-center z-[101] px-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden">
              <div className="px-6 pt-6 pb-4">
                {dialog.kind === 'confirm' && dialog.variant === 'danger' && (
                  <div className="w-10 h-10 rounded-xl bg-[#FEF2F2] flex items-center justify-center mb-3">
                    <AlertTriangle className="w-5 h-5 text-[#DC2626]" />
                  </div>
                )}
                {dialog.kind === 'alert' && (
                  <div className="w-10 h-10 rounded-xl bg-[#FEF2F2] flex items-center justify-center mb-3">
                    <AlertCircle className="w-5 h-5 text-[#DC2626]" />
                  </div>
                )}
                <h3 className="text-base font-semibold text-[#111] mb-1">{dialog.title}</h3>
                <p className="text-sm text-[#6B7280] leading-relaxed">{dialog.message}</p>
              </div>
              <div className="flex gap-2 px-6 pb-6">
                {dialog.kind === 'confirm' ? (
                  <>
                    <button
                      onClick={handleCancel}
                      className="flex-1 px-4 py-2.5 text-sm font-medium text-[#6B7280] bg-[#F3F4F6] rounded-xl hover:bg-[#E5E7EB] transition-colors"
                    >
                      {dialog.cancelLabel || 'Cancel'}
                    </button>
                    <button
                      onClick={handleConfirm}
                      className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                        dialog.variant === 'danger'
                          ? 'bg-[#DC2626] text-white hover:bg-[#B91C1C]'
                          : 'bg-[#2563EB] text-white hover:bg-[#1D4ED8]'
                      }`}
                    >
                      {dialog.confirmLabel || 'Confirm'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleOk}
                    className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors"
                  >
                    {dialog.okLabel || 'OK'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </ConfirmContext.Provider>
  )
}
