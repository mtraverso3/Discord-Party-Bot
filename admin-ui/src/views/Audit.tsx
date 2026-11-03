import { RefreshCw, ScrollText, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import { fmtAbs, relTime } from '../lib/time'
import type { AuditEntry } from '../types'
import { EmptyState, ErrorNote, PageSkeleton } from '../components/common'
import { Avatar } from '../components/Avatar'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { cn } from '@/lib/utils'

// Discord-identity admins are recorded with a synthetic "<discordId>@…" email
// (the OIDC provider has no real address). Surface those as the member's name.
const DISCORD_ID_RE = /^(\d{15,21})@/

// relTime returns "just now" for sub-minute gaps, so don't append " ago" to it.
function whenLabel(ts: number): string {
  const rel = relTime(Date.now() - ts)
  return rel === 'just now' ? rel : rel + ' ago'
}

function discordIdOf(email?: string): string | null {
  const m = email?.match(DISCORD_ID_RE)
  return m ? m[1]! : null
}

// The Discord user IDs an entry references, so we can resolve them to names:
// the acting admin (synthetic email) and any admin add/remove target.
function referencedIds(entry: AuditEntry): string[] {
  const ids: string[] = []
  const actor = discordIdOf(entry.email)
  if (actor) ids.push(actor)
  const target = entry.path.match(/^\/admins\/(\d{15,21})$/)
  if (target) ids.push(target[1]!)
  return ids
}

function friendlyAction(entry: AuditEntry, name: (id: string) => string): string {
  const parts = entry.path.split('/').filter(Boolean)
  const m = entry.method
  const [p0, p1, p2, p3] = parts

  if (p0 === 'clear') return 'Cleared all parties'
  if (p0 === 'admins' && !p1) return 'Added a Discord admin'
  if (p0 === 'admins' && p1) return 'Removed Discord admin ' + name(p1)
  if (p0 === 'settings') return 'Updated guild settings'
  if (p0 === 'templates' && !p1) return 'Created a party template'
  if (p0 === 'templates' && p1) {
    if (p2 === 'apply') return 'Created a party from template ' + p1
    if (!p2) return (m === 'DELETE' ? 'Deleted' : 'Edited') + ' party template ' + p1
  }
  if (p0 === 'parties' && !p1) return 'Created a party'
  if (p0 === 'parties' && p1) {
    if (!p2) return (m === 'DELETE' ? 'Disbanded' : 'Edited') + ' party ' + p1
    if (p2 === 'close') return 'Closed party ' + p1
    if (p2 === 'open') return 'Opened party ' + p1
    if (p2 === 'bump') return 'Bumped embed for party ' + p1
    if (p2 === 'banlist') return 'Updated banlist for party ' + p1
    if (p2 === 'members' && !p3) return 'Added a member to party ' + p1
    if (p2 === 'members' && p3) {
      if (parts[4] === 'approve') return `Approved ${p3} into party ${p1}`
      if (parts[4] === 'promote') return `Promoted ${p3} in party ${p1}`
      return `Removed ${p3} from party ${p1}`
    }
    if (p2 === 'queue' && p3) {
      if (parts[4] === 'move') return `Reordered ${p3} in queue of party ${p1}`
      return `Denied ${p3} from queue of party ${p1}`
    }
  }
  if (p0 === 'users' && p1) {
    if (p2 === 'profile') return 'Edited IGN profile of ' + p1
    if (p2 === 'unstick') return 'Cleared stale party mapping of ' + p1
  }
  return m + ' ' + entry.path
}

const METHOD_TONE: Record<string, string> = {
  POST: 'bg-primary/10 text-primary',
  PATCH: 'bg-warning-muted text-warning',
  DELETE: 'bg-danger-muted text-destructive',
}

export function Audit() {
  const { data: log, error, reload } = useLoad(() => api<AuditEntry[]>('/log'))
  const [names, setNames] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  // Resolve every referenced Discord ID (acting admin + admin add/remove
  // targets) to a member name in one batched request.
  useEffect(() => {
    if (!log) return
    const ids = [...new Set(log.flatMap(referencedIds))]
    if (ids.length === 0) return
    api<Record<string, string>>('/members/resolve?ids=' + encodeURIComponent(ids.join(',')))
      .then(map => setNames(n => ({ ...n, ...(map || {}) })))
      .catch(() => { /* fall back to the raw ID */ })
  }, [log])

  const name = (id: string): string => names[id] || id
  const adminLabel = (email?: string): string => {
    const id = discordIdOf(email)
    if (id) return name(id)
    return email || '—'
  }

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!log) return <PageSkeleton rows={6} />
  if (log.length === 0) return <EmptyState icon={<ScrollText />} title="No admin actions recorded yet" />

  const q = query.trim().toLowerCase()
  const rows = log
    .map(entry => ({ entry, admin: adminLabel(entry.email), action: friendlyAction(entry, name) }))
    .filter(r => !q || r.admin.toLowerCase().includes(q) || r.action.toLowerCase().includes(q))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-8" placeholder="Filter by admin or action" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Button variant="outline" onClick={async () => { setRefreshing(true); await reload(); setRefreshing(false) }}>
          <RefreshCw className={cn(refreshing && 'animate-spin')} />Refresh
        </Button>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b bg-muted/30 px-6 py-2.5 text-xs text-muted-foreground">
          {rows.length === log.length
            ? `${log.length} recorded action${log.length === 1 ? '' : 's'}`
            : `${rows.length} of ${log.length} actions`}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-36">When</TableHead>
              <TableHead className="w-56">Admin</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ entry, admin, action }, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap text-muted-foreground" title={fmtAbs(entry.ts)}>
                  {whenLabel(entry.ts)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <Avatar name={admin} className="size-6" />
                    <span className="max-w-44 truncate">{admin}</span>
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Badge className={cn('w-14 justify-center font-mono text-[0.65rem]', METHOD_TONE[entry.method])}>{entry.method}</Badge>
                    <span>{action}</span>
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">No actions match “{query}”.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
