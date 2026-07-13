import { Gamepad2, Swords, Timer, Users as UsersIcon, Hourglass, CircleDot, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import { useGuildData } from '../lib/guildData'
import { deadlineOf, fmtAbs, relTime } from '../lib/time'
import type { GuildSettings, Party } from '../types'
import { Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorNote, Mono, Spinner, Table, TBody, THead } from '../components/ui'

export function Dashboard() {
  const guildData = useGuildData()
  const { data, error } = useLoad(async () => {
    const [parties, settings] = await Promise.all([
      api<Party[]>('/parties'),
      guildData.getSettings(true),
    ])
    return { parties, settings }
  })

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!data) return <Spinner />
  const { parties, settings } = data

  return (
    <div className="space-y-6">
      <Stats parties={parties} settings={settings} />
      {parties.length === 0 ? (
        <EmptyState icon={<Swords />} title="No active parties">
          <a className="text-primary hover:underline" href="#/parties">Create one</a> from the Parties tab.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>By game</CardTitle></CardHeader>
            <CardContent className="pt-3"><ByGame parties={parties} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Next auto-disbands</CardTitle></CardHeader>
            <CardContent className="pt-3"><DisbandsSoon parties={parties} /></CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader><CardTitle>Top active parties</CardTitle></CardHeader>
            <CardContent className="pt-3"><TopActive parties={parties} /></CardContent>
          </Card>
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

  const stat = (num: string | number, lbl: string, icon: ReactNode) => (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xl font-bold tracking-tight">{String(num)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{lbl}</div>
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary [&_svg]:size-4">{icon}</div>
      </div>
    </Card>
  )
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stat(`${parties.length} / ${settings.maxParties}`, 'Active parties', <Swords />)}
      {stat(members, 'Players in parties', <UsersIcon />)}
      {stat(queued, 'Waiting in queues', <Hourglass />)}
      {stat(`${open} · ${full} · ${closed}`, 'Open · Full · Closed', <CircleDot />)}
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
    <Table>
      <THead><tr><th>Game</th><th>Parties</th><th>Players</th></tr></THead>
      <TBody>
        {[...byGame.entries()].map(([g, n]) => (
          <tr key={g}>
            <td className="font-medium"><span className="inline-flex items-center gap-2"><Gamepad2 className="size-3.5 text-muted-foreground" />{g}</span></td>
            <td>{n.parties}</td>
            <td>{n.members}</td>
          </tr>
        ))}
      </TBody>
    </Table>
  )
}

function TopActive({ parties }: { parties: Party[] }) {
  const top = [...parties]
    .sort((a, b) => b.members.length - a.members.length || a.maxSize - b.maxSize)
    .slice(0, 5)

  if (top.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">No active parties.</p>
  }
  return (
    <div className="divide-y">
      {top.map(p => (
        <PartyRow key={p.id} p={p}>
          <FillBar filled={p.members.length} total={p.maxSize} />
        </PartyRow>
      ))}
    </div>
  )
}

function FillBar({ filled, total }: { filled: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (filled / total) * 100) : 0
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{filled}/{total}</span>
    </div>
  )
}

function DisbandsSoon({ parties }: { parties: Party[] }) {
  const now = Date.now()
  const soon = parties
    .map(p => ({ p, deadline: deadlineOf(p) }))
    .sort((a, b) => a.deadline - b.deadline)
    .slice(0, 5)
  return (
    <div className="divide-y">
      {soon.map(({ p, deadline }) => (
        <PartyRow key={p.id} p={p}>
          <span
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            title={fmtAbs(deadline)}
          >
            <Timer className="size-3.5" />
            {deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'}
          </span>
        </PartyRow>
      ))}
    </div>
  )
}

/** A party list row that links to the party's detail page in the Parties tab. */
function PartyRow({ p, children }: { p: Party; children: ReactNode }) {
  return (
    <a
      href={`#/parties/${encodeURIComponent(p.id)}`}
      className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors first:mt-0 hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{p.name}</div>
        <Mono>{p.id}</Mono>
      </div>
      {children}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
    </a>
  )
}
