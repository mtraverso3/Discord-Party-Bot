import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import { useGuildData } from '../lib/guildData'
import { deadlineOf, fmtAbs, relTime } from '../lib/time'
import type { GuildSettings, Party } from '../types'

export function Dashboard() {
  const guildData = useGuildData()
  const { data, error } = useLoad(async () => {
    const [parties, settings] = await Promise.all([
      api<Party[]>('/parties'),
      guildData.getSettings(true),
    ])
    return { parties, settings }
  })

  if (error) return <article>Error: {error}</article>
  if (!data) return <progress />
  const { parties, settings } = data

  return (
    <div>
      <Stats parties={parties} settings={settings} />
      {parties.length === 0 ? (
        <div className="empty">No active parties. <a href="#/parties">Create one</a> from the Parties tab.</div>
      ) : (
        <div className="grid-2col">
          <article><h5>By game</h5><ByGame parties={parties} /></article>
          <article><h5>Next auto-disbands</h5><DisbandsSoon parties={parties} /></article>
        </div>
      )}
    </div>
  )
}

function Stats({ parties, settings }: { parties: Party[]; settings: GuildSettings }) {
  const members = parties.reduce((a, p) => a + p.members.length, 0)
  const queued = parties.reduce((a, p) => a + p.queue.length, 0)
  const open = parties.filter(p => !p.isClosed && p.members.length < p.maxSize).length
  const full = parties.filter(p => !p.isClosed && p.members.length >= p.maxSize).length
  const closed = parties.filter(p => p.isClosed).length

  const stat = (num: string | number, lbl: string) => (
    <div className="stat"><div className="num">{String(num)}</div><div className="lbl">{lbl}</div></div>
  )
  return (
    <div className="stat-grid">
      {stat(`${parties.length} / ${settings.maxParties}`, 'Active parties')}
      {stat(members, 'Players in parties')}
      {stat(queued, 'Waiting in queues')}
      {stat(`${open} · ${full} · ${closed}`, 'Open · Full · Closed')}
    </div>
  )
}

function ByGame({ parties }: { parties: Party[] }) {
  const byGame = new Map<string, { parties: number; members: number }>()
  for (const p of parties) {
    const g = byGame.get(p.game) || { parties: 0, members: 0 }
    g.parties++
    g.members += p.members.length
    byGame.set(p.game, g)
  }
  return (
    <table className="compact">
      <thead><tr><th>Game</th><th>Parties</th><th>Players</th></tr></thead>
      <tbody>
        {[...byGame.entries()].map(([g, n]) => (
          <tr key={g}><td>{g}</td><td>{n.parties}</td><td>{n.members}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

function DisbandsSoon({ parties }: { parties: Party[] }) {
  const now = Date.now()
  const soon = parties
    .map(p => ({ p, deadline: deadlineOf(p) }))
    .sort((a, b) => a.deadline - b.deadline)
    .slice(0, 5)
  return (
    <div>
      {soon.map(({ p, deadline }) => (
        <div className="row" key={p.id}>
          <div className="who">
            <strong>{p.name}</strong> <span className="uid">{p.id}</span>
          </div>
          <span className="muted" title={fmtAbs(deadline)}>
            {deadline > now ? '⏱ in ' + relTime(deadline - now) : '⏱ overdue'}
          </span>
        </div>
      ))}
    </div>
  )
}
