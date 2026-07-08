import { RefreshCw, ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import { fmtAbs, relTime } from '../lib/time'
import type { AuditEntry } from '../types'
import { Button, Card, EmptyState, ErrorNote, Spinner, Table, TBody, THead } from '../components/ui'

// Discord-identity admins are recorded with a synthetic "<discordId>@…" email
// (the OIDC provider has no real address). Surface those as the member's name.
const DISCORD_ID_RE = /^(\d{15,21})@/

function discordIdOf(email?: string): string | null {
  const m = email?.match(DISCORD_ID_RE)
  return m ? m[1]! : null
}

function friendlyAction(entry: AuditEntry): string {
  const parts = entry.path.split('/').filter(Boolean)
  const m = entry.method
  const [p0, p1, p2, p3] = parts

  if (p0 === 'clear') return 'Cleared all parties'
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

export function Audit() {
  const { data: log, error, reload } = useLoad(() => api<AuditEntry[]>('/log'))
  const [names, setNames] = useState<Record<string, string>>({})

  // Resolve the Discord IDs behind synthetic admin emails to member names.
  useEffect(() => {
    if (!log) return
    const ids = [...new Set(log.map(e => discordIdOf(e.email)).filter((x): x is string => !!x))]
    if (ids.length === 0) return
    api<Record<string, string>>('/members/resolve?ids=' + encodeURIComponent(ids.join(',')))
      .then(map => setNames(n => ({ ...n, ...(map || {}) })))
      .catch(() => { /* fall back to the raw ID */ })
  }, [log])

  const adminLabel = (email?: string): string => {
    const id = discordIdOf(email)
    if (id) return `${names[id] || id} · Discord`
    return email || '—'
  }

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!log) return <Spinner />
  if (log.length === 0) return <EmptyState icon={<ScrollText />} title="No admin actions recorded yet" />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{log.length} recorded action{log.length === 1 ? '' : 's'}</span>
        <Button variant="outline" size="sm" onClick={reload}><RefreshCw />Refresh</Button>
      </div>
      <Card>
        <Table>
          <THead><tr><th>When</th><th>Admin</th><th>Action</th></tr></THead>
          <TBody>
            {log.map((entry, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap text-muted-foreground" title={fmtAbs(entry.ts)}>
                  {relTime(Date.now() - entry.ts)} ago
                </td>
                <td className="whitespace-nowrap">{adminLabel(entry.email)}</td>
                <td>{friendlyAction(entry)}</td>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  )
}
