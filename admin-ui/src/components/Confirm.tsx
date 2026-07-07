import { TriangleAlert } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './ui'

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
      className="animate-dialog-in m-auto w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-xl"
      onClose={() => onFinish(false)}
      onClick={e => { if (e.target === ref.current) onFinish(false) }}
    >
      <div className="flex gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-muted">
          <TriangleAlert className="size-4 text-destructive" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Are you sure?</h2>
          <p className="mt-1 text-sm text-muted-foreground">{pending.message}</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onFinish(false)}>Cancel</Button>
        <Button variant="destructive" size="sm" onClick={() => onFinish(true)}>{pending.confirmLabel}</Button>
      </div>
    </dialog>
  )
}
