import { hueOf } from '../lib/time'

export function Avatar({ name }: { name?: string }) {
  const n = name || '?'
  return (
    <span className="av" style={{ background: `hsl(${hueOf(n)}, 48%, 46%)` }}>
      {n.slice(0, 1).toUpperCase()}
    </span>
  )
}
