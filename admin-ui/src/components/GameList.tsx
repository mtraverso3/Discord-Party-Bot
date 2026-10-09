import { Gamepad2 } from 'lucide-react'
import type { GameParticipant, PartyGame } from '../types'
import { fmtAbs, relTime } from '../lib/time'
import { Badge, EmptyState } from './ui'

// Common League queue IDs → a short human label. Anything unmapped shows the
// raw id so we never hide information we simply haven't named yet.
const QUEUE_LABELS: Record<number, string> = {
  0: 'Custom',
  400: 'Normal Draft',
  420: 'Ranked Solo',
  430: 'Normal Blind',
  440: 'Ranked Flex',
  450: 'ARAM',
  700: 'Clash',
  830: 'Co-op vs AI',
  840: 'Co-op vs AI',
  850: 'Co-op vs AI',
  900: 'URF',
  1700: 'Arena',
  1710: 'Arena',
  1750: 'Arena',
  1900: 'URF',
  2400: 'ARAM Mayhem',
}

function queueLabel(id?: number): string | null {
  if (id == null) return null
  return QUEUE_LABELS[id] ?? `Queue ${id}`
}

function duration(seconds?: number): string | null {
  if (!seconds) return null
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

function statusBadge(g: PartyGame) {
  if (g.status === 'resolved') return <Badge variant="success">Resolved</Badge>
  if (g.status === 'failed') return <Badge variant="destructive">Unavailable</Badge>
  return <Badge variant="warning">Pending</Badge>
}

function ordinal(n: number): string {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

function Team({ title, players, result }: { title: string; players: GameParticipant[]; result?: 'win' | 'placement' }) {
  if (players.length === 0) return null
  const won = players[0]?.win
  const placement = players.find(p => p.placement)?.placement
  return (
    <div className="min-w-40 flex-1">
      <div className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
        {result === 'win' && won != null && <Badge variant={won ? 'success' : 'destructive'}>{won ? 'Win' : 'Loss'}</Badge>}
        {result === 'placement' && placement != null && (
          <Badge variant={placement === 1 ? 'success' : 'secondary'}>{ordinal(placement)}</Badge>
        )}
      </div>
      <ul className="space-y-0.5">
        {players.map(p => (
          <li key={p.puuid} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{p.championName || `Champion ${p.championId}`}</span>
            <span className="truncate text-xs text-muted-foreground" title={p.riotId}>{p.riotId || '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Arena-style games: one group per subteam, best placement first. */
function subteams(players: GameParticipant[]): GameParticipant[][] {
  const groups = new Map<number, GameParticipant[]>()
  for (const p of players) groups.set(p.subteam ?? 0, [...(groups.get(p.subteam ?? 0) ?? []), p])
  const rank = (group: GameParticipant[]) => group.find(p => p.placement)?.placement ?? Infinity
  return [...groups.entries()].sort(([a, x], [b, y]) => rank(x) - rank(y) || a - b).map(([, group]) => group)
}

function Teams({ players }: { players: GameParticipant[] }) {
  if (players.some(p => p.subteam)) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
        {subteams(players).map(group => (
          <Team key={group[0]!.puuid} title={`Team ${group[0]!.subteam ?? '?'}`} players={group} result="placement" />
        ))}
      </div>
    )
  }
  const blue = players.filter(p => p.teamId === 100)
  const red = players.filter(p => p.teamId === 200)
  const other = players.filter(p => p.teamId !== 100 && p.teamId !== 200)
  return (
    <div className="flex flex-wrap gap-4">
      <Team title="Blue" players={blue} result="win" />
      <Team title="Red" players={red} result="win" />
      <Team title="Players" players={other} />
    </div>
  )
}

function GameCard({ game: g }: { game: PartyGame }) {
  const ql = queueLabel(g.queueId)
  const dur = duration(g.gameDuration)

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {statusBadge(g)}
        {ql && <Badge variant="outline">{ql}</Badge>}
        {g.region && <Badge variant="secondary">{g.region}</Badge>}
        <span className="font-mono text-[0.7rem] text-muted-foreground">{g.matchId}</span>
        <span className="grow" />
        {dur && <span className="text-muted-foreground">{dur}</span>}
        <span
          className="text-muted-foreground"
          title={'Reported ' + fmtAbs(g.reportedAt)}
        >
          {relTime(Date.now() - g.reportedAt)} ago
        </span>
      </div>
      {g.participants.length > 0 ? (
        <Teams players={g.participants} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {g.status === 'failed'
            ? (g.error ? `Couldn’t load this match: ${g.error}` : 'This match couldn’t be loaded (custom games aren’t in the Riot match history).')
            : 'Waiting for the match to finish so Riot can report who played…'}
        </p>
      )}
    </div>
  )
}

/** Renders the League games reported for a party session. */
export function GameList({ games }: { games: PartyGame[] }) {
  if (games.length === 0) {
    return (
      <EmptyState icon={<Gamepad2 />} title="No games reported">
        When a party member runs the desktop client and starts a League game, it shows up here.
      </EmptyState>
    )
  }
  return (
    <div className="space-y-2.5">
      {games.map(g => <GameCard key={g.id} game={g} />)}
    </div>
  )
}
