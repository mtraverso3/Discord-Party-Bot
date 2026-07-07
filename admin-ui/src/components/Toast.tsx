import { CheckCircle2, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'

type ToastFn = (msg: string, kind?: 'ok' | 'err') => void

const ToastContext = createContext<ToastFn>(() => {})

export function useToast(): ToastFn {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback<ToastFn>((msg, kind = 'ok') => {
    setToast({ msg, kind })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), kind === 'err' ? 5000 : 2500)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          className={cn(
            'animate-toast-in fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-2.5 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg',
            toast.kind === 'err' && 'border-destructive/40',
          )}
          role="status"
        >
          {toast.kind === 'err'
            ? <XCircle className="size-4 shrink-0 text-destructive" />
            : <CheckCircle2 className="size-4 shrink-0 text-success" />}
          {toast.msg}
        </div>
      )}
    </ToastContext.Provider>
  )
}
