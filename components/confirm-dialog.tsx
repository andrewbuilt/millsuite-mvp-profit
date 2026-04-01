'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextType>({
  confirm: async () => false,
})

export function useConfirm() {
  return useContext(ConfirmContext)
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setDialog({ ...options, resolve })
    })
  }, [])

  function handleConfirm() {
    dialog?.resolve(true)
    setDialog(null)
  }

  function handleCancel() {
    dialog?.resolve(false)
    setDialog(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}

      {dialog && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/30 z-[100]" onClick={handleCancel} />

          {/* Dialog */}
          <div className="fixed inset-0 flex items-center justify-center z-[101] px-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden">
              <div className="px-6 pt-6 pb-4">
                {dialog.variant === 'danger' && (
                  <div className="w-10 h-10 rounded-xl bg-[#FEF2F2] flex items-center justify-center mb-3">
                    <AlertTriangle className="w-5 h-5 text-[#DC2626]" />
                  </div>
                )}
                <h3 className="text-base font-semibold text-[#111] mb-1">{dialog.title}</h3>
                <p className="text-sm text-[#6B7280] leading-relaxed">{dialog.message}</p>
              </div>
              <div className="flex gap-2 px-6 pb-6">
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
              </div>
            </div>
          </div>
        </>
      )}
    </ConfirmContext.Provider>
  )
}
