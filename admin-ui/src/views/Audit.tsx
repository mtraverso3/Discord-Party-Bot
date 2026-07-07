import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import { fmtAbs, relTime } from '../lib/time'
import type { AuditEntry } from '../types'

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

  if (error) return <article>Error: {error}</article>
  if (!log) return <progress />
  if (log.length === 0) return <div className="empty">No admin actions recorded yet.</div>

  return (
    <div>
      <div className="toolbar">
        <span className="muted grow">{log.length} recorded action{log.length === 1 ? '' : 's'}</span>
        <button className="secondary tiny" onClick={reload}>Refresh</button>
      </div>
      <article>
        <table className="compact">
          <thead><tr><th>When</th><th>Admin</th><th>Action</th></tr></thead>
          <tbody>
            {log.map((entry, i) => (
              <tr key={i}>
                <td title={fmtAbs(entry.ts)}>{relTime(Date.now() - entry.ts)} ago</td>
                <td>{entry.email || '—'}</td>
                <td>{friendlyAction(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  )
}
