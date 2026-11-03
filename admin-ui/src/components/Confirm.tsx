import { TriangleAlert } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from './ui/alert-dialog'

type ConfirmFn = (message: string, confirmLabel?: string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(async () => false)

/** Promise-based replacement for window.confirm, rendered as a shadcn AlertDialog. */
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
  const [open, setOpen] = useState(false)

  const confirm = useCallback<ConfirmFn>((message, confirmLabel = 'Confirm') =>
    new Promise<boolean>(resolve => { setPending({ message, confirmLabel, resolve }); setOpen(true) }), [])

  const finish = (v: boolean) => {
    pending?.resolve(v)
    setOpen(false)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={o => { if (!o) finish(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader className="sm:flex-row sm:items-start sm:gap-4">
            <div className="mx-auto flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-muted sm:mx-0">
              <TriangleAlert className="size-5 text-destructive" />
            </div>
            <div className="grid gap-1.5">
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>{pending?.message}</AlertDialogDescription>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => finish(true)}>{pending?.confirmLabel}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}
