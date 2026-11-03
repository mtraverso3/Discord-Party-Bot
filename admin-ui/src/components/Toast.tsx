import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { toast as sonner } from 'sonner'
import { Toaster } from './ui/sonner'

type ToastFn = (msg: string, kind?: 'ok' | 'err') => void

const ToastContext = createContext<ToastFn>(() => {})

/** `toast(message, 'ok' | 'err')` — a thin wrapper over sonner so views keep one call shape. */
export function useToast(): ToastFn {
  return useContext(ToastContext)
}

export function ToastProvider({ theme, children }: { theme: 'light' | 'dark'; children: ReactNode }) {
  const show = useCallback<ToastFn>((msg, kind = 'ok') => {
    if (kind === 'err') sonner.error(msg, { duration: 5000 })
    else sonner.success(msg, { duration: 2500 })
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Toaster theme={theme} position="bottom-right" />
    </ToastContext.Provider>
  )
}
