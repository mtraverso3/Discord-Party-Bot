import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from './cn'

/* Same hand-rolled shadcn-style primitives as the admin UI, trimmed to what
   the client needs. */

/* ── Button ── */

type ButtonVariant = 'default' | 'outline' | 'ghost'
type ButtonSize = 'default' | 'sm' | 'icon'

const buttonVariants: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
  outline: 'border border-border bg-card shadow-sm hover:bg-accent hover:text-accent-foreground',
  ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
}

const buttonSizes: Record<ButtonSize, string> = {
  default: 'h-9 px-4',
  sm: 'h-8 px-3 text-xs',
  icon: 'h-8 w-8',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  busy?: boolean
}

export function Button({ className, variant = 'default', size = 'default', busy, disabled, children, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {busy && <Loader2 className="animate-spin" />}
      {children}
    </button>
  )
}

/* ── Form controls ── */

const fieldBase =
  'w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm transition-colors ' +
  'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'h-9', className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'h-9 appearance-none bg-no-repeat pr-8', 'bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23888%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[position:right_0.6rem_center]', className)} {...props}>
      {children}
    </select>
  )
}

export function Switch({ checked, onCheckedChange, className, ...props }: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'block size-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[1.05rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

/* ── Card ── */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)} {...props} />
}

/* ── Badge ── */

type BadgeVariant = 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

const badgeVariants: Record<BadgeVariant, string> = {
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'border-border text-muted-foreground',
  success: 'border-transparent bg-success-muted text-success',
  warning: 'border-transparent bg-warning-muted text-warning',
  destructive: 'border-transparent bg-danger-muted text-destructive',
}

export function Badge({ className, variant = 'secondary', ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-32 items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[0.68rem] font-medium whitespace-nowrap',
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  )
}

export function StatusDot({ className }: { className?: string }) {
  return <span className={cn('size-1.5 shrink-0 rounded-full bg-current', className)} />
}

/* ── Misc ── */

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
      {icon && <div className="text-muted-foreground/60 [&_svg]:size-7 [&_svg]:stroke-[1.5]">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="text-xs text-muted-foreground">{children}</div>}
    </div>
  )
}

export function Avatar({ name, highlight, imageUrl, title }: {
  name: string
  highlight?: boolean
  imageUrl?: string | null
  title?: string
}) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={title ?? name}
        title={title}
        className={cn(
          'size-8 shrink-0 rounded-full object-cover',
          highlight && 'ring-2 ring-primary/50',
        )}
      />
    )
  }
  return (
    <span className={cn(
      'grid size-8 shrink-0 place-items-center rounded-full text-[0.7rem] font-semibold',
      highlight ? 'bg-primary/25 text-foreground' : 'bg-muted text-muted-foreground',
    )}>
      {initials}
    </span>
  )
}
