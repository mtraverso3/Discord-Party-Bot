import { CircleCheck, CircleX, Info, Loader2, TriangleAlert } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/** shadcn's Toaster, themed from the document's data-theme attribute. */
function Toaster({ theme, ...props }: ToasterProps) {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        error: <CircleX className="size-4 text-destructive" />,
        info: <Info className="size-4 text-primary" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        loading: <Loader2 className="size-4 animate-spin" />,
      }}
      style={{
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
        '--border-radius': 'var(--radius)',
      } as React.CSSProperties}
      {...props}
    />
  )
}

export { Toaster }
