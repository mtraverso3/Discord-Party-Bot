import { CircleAlert, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from './ui/alert'
import { Checkbox } from './ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Skeleton } from './ui/skeleton'
import { useToast } from './Toast'

/* App-level building blocks layered on the shadcn primitives in ./ui. */

/** Loading placeholder shaped like a typical page: a toolbar row and a few cards. */
export function PageSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-4', className)} aria-busy="true" aria-label="Loading">
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    </div>
  )
}

/** Inline loading block for a section inside a page. */
export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  )
}

export function EmptyState({ icon, title, children, action, className }: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/40 px-6 py-12 text-center', className)}>
      {icon && (
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {children && <div className="mx-auto max-w-sm text-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

export function Mono({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('font-mono text-xs text-muted-foreground', className)} {...props} />
}

export function StatusDot({ className }: { className?: string }) {
  return <span className={cn('size-1.5 shrink-0 rounded-full bg-current', className)} />
}

/** A labelled form control. Wraps in <label> so clicking the text focuses the control. */
export function Field({ label, hint, className, children }: {
  label: ReactNode
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <label className={cn('grid content-start gap-2', className)}>
      <span className="text-sm leading-none font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** A checkbox laid out as a bordered option with a title and description. */
export function CheckboxCard({ checked, onCheckedChange, disabled, title, description, className }: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  title: ReactNode
  description?: ReactNode
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50',
        'has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <Checkbox className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={v => onCheckedChange(v === true)} />
      <span className="grid gap-1">
        <span className="text-sm leading-none font-medium">{title}</span>
        {description && <span className="text-sm text-muted-foreground">{description}</span>}
      </span>
    </label>
  )
}

/** Small metric tile used inside cards. */
export function MiniStat({ label, value, title, className }: {
  label: string
  value: ReactNode
  title?: string
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border bg-muted/30 px-3 py-2.5', className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums" title={title}>{value ?? '—'}</div>
    </div>
  )
}

/** Uppercase section label used above lists inside cards. */
export function SectionLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-xs font-medium tracking-wide text-muted-foreground uppercase', className)} {...props} />
}

export function GameSelect({ value, onChange, games }: { value: string; onChange: (g: string) => void; games: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Pick a game" /></SelectTrigger>
      <SelectContent>
        {games.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

export function CountPill({ n }: { n: number }) {
  return <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[0.7rem] leading-4 font-medium tabular-nums">{n}</span>
}

export function CopyId({ id, label }: { id: string; label?: string }) {
  const toast = useToast()
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
      title="Copy ID"
      onClick={() => { navigator.clipboard?.writeText(id).then(() => toast((label ?? 'ID') + ' copied')).catch(() => {}) }}
    >
      <Mono className="text-inherit">{id}</Mono><Copy className="size-3" />
    </button>
  )
}
