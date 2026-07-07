import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

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
      {toast && <div id="toast" className={toast.kind === 'err' ? 'err' : ''}>{toast.msg}</div>}
    </ToastContext.Provider>
  )
}
