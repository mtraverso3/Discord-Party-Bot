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
  1900: 'URF',
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

function Team({ title, players }: { title: string; players: GameParticipant[] }) {
  if (players.length === 0) return null
  const won = players[0]?.win
  return (
    <div className="min-w-40 flex-1">
      <div className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
        {won != null && <Badge variant={won ? 'success' : 'destructive'}>{won ? 'Win' : 'Loss'}</Badge>}
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

function GameCard({ game: g }: { game: PartyGame }) {
  const blue = g.participants.filter(p => p.teamId === 100)
  const red = g.participants.filter(p => p.teamId === 200)
  const other = g.participants.filter(p => p.teamId !== 100 && p.teamId !== 200)
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
        <div className="flex flex-wrap gap-4">
          <Team title="Blue" players={blue} />
          <Team title="Red" players={red} />
          <Team title="Players" players={other} />
        </div>
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
