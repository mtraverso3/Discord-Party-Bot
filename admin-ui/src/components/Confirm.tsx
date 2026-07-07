import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type ConfirmFn = (message: string, confirmLabel?: string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(async () => false)

/** Promise-based replacement for window.confirm using a styled <dialog>. */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext)
}

interface Pending {
  message: string
  confirmLabel: string
  resolve: (v: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback<ConfirmFn>((message, confirmLabel = 'Confirm') =>
    new Promise<boolean>(resolve => setPending({ message, confirmLabel, resolve })), [])

  const finish = (v: boolean) => {
    pending?.resolve(v)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog pending={pending} onFinish={finish} />}
    </ConfirmContext.Provider>
  )
}

function ConfirmDialog({ pending, onFinish }: { pending: Pending; onFinish: (v: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog
      ref={ref}
      className="confirm"
      onClose={() => onFinish(false)}
      onClick={e => { if (e.target === ref.current) onFinish(false) }}
    >
      <p>{pending.message}</p>
      <div className="dlg-actions">
        <button type="button" className="ghost" onClick={() => onFinish(false)}>Cancel</button>
        <button type="button" className="danger" onClick={() => onFinish(true)}>{pending.confirmLabel}</button>
      </div>
    </dialog>
  )
}
