import { hueOf } from '../lib/time'
import { cn } from '../lib/cn'

export function Avatar({ name, className }: { name?: string; className?: string }) {
  const n = name || '?'
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white select-none',
        className,
      )}
      style={{ background: `hsl(${hueOf(n)}, 48%, 46%)` }}
    >
      {n.slice(0, 1).toUpperCase()}
    </span>
  )
}
