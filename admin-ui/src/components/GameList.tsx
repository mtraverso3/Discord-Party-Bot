import { useState } from 'react'
import { ChevronDown, Gamepad2 } from 'lucide-react'
import type { GameParticipant, PartyGame } from '../types'
import { cn } from '../lib/cn'
import { fmtAbs, relTime } from '../lib/time'
import { championIconUrl, useLoadoutCatalog, type AugmentRarity, type LoadoutAsset, type LoadoutCatalog } from '../lib/lolAssets'
import { HoverCard } from './HoverCard'
import { LeagueText } from './LeagueText'
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

const RARITY_RING: Record<AugmentRarity, string> = {
  silver: 'ring-zinc-400',
  gold: 'ring-amber-400',
  prismatic: 'ring-fuchsia-400',
  other: 'ring-border',
}

const RARITY_TEXT: Record<AugmentRarity, string> = {
  silver: 'text-zinc-300',
  gold: 'text-amber-300',
  prismatic: 'text-fuchsia-300',
  other: 'text-zinc-200',
}

function ItemTip({ id, item }: { id: number; item?: LoadoutAsset }) {
  return (
    <>
      <div className="mb-1 text-sm font-semibold text-amber-100">{item?.name ?? `Item ${id}`}</div>
      {item?.description ? <LeagueText text={item.description} /> : <span className="text-zinc-400">No description available.</span>}
    </>
  )
}

function AugmentTip({ id, augment }: { id: number; augment?: LoadoutCatalog['augments'][number] }) {
  const rarity = augment?.rarity ?? 'other'
  return (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={cn('text-sm font-semibold', RARITY_TEXT[rarity])}>{augment?.name ?? `Augment ${id}`}</span>
        {rarity !== 'other' && <span className="text-[0.65rem] tracking-wide text-zinc-400 uppercase">{rarity}</span>}
      </div>
      {augment?.description ? <LeagueText text={augment.description} /> : <span className="text-zinc-400">No description available.</span>}
    </>
  )
}

function Icon({ src, label, className }: { src?: string | null; label: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return (
      <span className={cn('inline-flex items-center justify-center bg-muted text-[0.6rem] font-semibold text-muted-foreground', className)}>
        {label.slice(0, 1)}
      </span>
    )
  }
  return <img src={src} alt={label} loading="lazy" onError={() => setBroken(true)} className={className} />
}

/** What a player finished with: items, then augments ringed by rarity. */
function Loadout({ player: p, catalog }: { player: GameParticipant; catalog: LoadoutCatalog | null }) {
  if (p.items.length === 0 && p.augments.length === 0) return null
  return (
    <div className="mt-0.5 mb-1 flex flex-wrap items-center gap-0.5">
      {p.items.map((id, i) => {
        const item = catalog?.items[id]
        return (
          <HoverCard key={`i${i}`} content={<ItemTip id={id} item={item} />}>
            <Icon src={item?.iconUrl} label={item?.name ?? `Item ${id}`} className="size-5 rounded-sm" />
          </HoverCard>
        )
      })}
      {p.items.length > 0 && p.augments.length > 0 && <span className="mx-1 h-4 w-px bg-border" />}
      {p.augments.map((id, i) => {
        const augment = catalog?.augments[id]
        return (
          <HoverCard key={`a${i}`} content={<AugmentTip id={id} augment={augment} />}>
            {/* Augment icons are white line art on transparent; the dark backing
                keeps them visible on the light theme, as the game shows them. */}
            <Icon
              src={augment?.iconUrl} label={augment?.name ?? `Augment ${id}`}
              className={cn('size-5 rounded-full bg-zinc-800 p-0.5 ring-1', RARITY_RING[augment?.rarity ?? 'other'])}
            />
          </HoverCard>
        )
      })}
    </div>
  )
}

function ChampionIcon({ player: p, catalog, className }: { player: GameParticipant; catalog: LoadoutCatalog | null; className?: string }) {
  const name = p.championName || `Champion ${p.championId}`
  return (
    <HoverCard content={<><div className="text-sm font-semibold text-amber-100">{name}</div><div className="text-zinc-400">{p.riotId || 'Unknown player'}</div></>}>
      <Icon src={championIconUrl(catalog, p.championName)} label={name} className={cn('size-6 rounded', className)} />
    </HoverCard>
  )
}

function ResultBadge({ players, result }: { players: GameParticipant[]; result?: 'win' | 'placement' }) {
  const won = players[0]?.win
  const placement = players.find(p => p.placement)?.placement
  if (result === 'win' && won != null) return <Badge variant={won ? 'success' : 'destructive'}>{won ? 'Win' : 'Loss'}</Badge>
  if (result === 'placement' && placement != null) {
    return <Badge variant={placement === 1 ? 'success' : 'secondary'}>{ordinal(placement)}</Badge>
  }
  return null
}

function Team({ title, players, result, catalog }: {
  title: string
  players: GameParticipant[]
  result?: 'win' | 'placement'
  catalog: LoadoutCatalog | null
}) {
  if (players.length === 0) return null
  return (
    <div className="min-w-40 flex-1">
      <div className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
        <ResultBadge players={players} result={result} />
      </div>
      <ul className="space-y-1">
        {players.map(p => (
          <li key={p.puuid} className="flex gap-2 text-sm">
            <ChampionIcon player={p} catalog={catalog} className="mt-0.5 size-7" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{p.championName || `Champion ${p.championId}`}</span>
                <span className="truncate text-xs text-muted-foreground" title={p.riotId}>{p.riotId || '—'}</span>
              </div>
              <Loadout player={p} catalog={catalog} />
            </div>
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

interface TeamGroup { key: string; title: string; players: GameParticipant[]; result?: 'win' | 'placement' }

function teamGroups(players: GameParticipant[]): TeamGroup[] {
  if (players.some(p => p.subteam)) {
    return subteams(players).map(group => ({
      key: group[0]!.puuid, title: `Team ${group[0]!.subteam ?? '?'}`, players: group, result: 'placement' as const,
    }))
  }
  return [
    { key: 'blue', title: 'Blue', players: players.filter(p => p.teamId === 100), result: 'win' as const },
    { key: 'red', title: 'Red', players: players.filter(p => p.teamId === 200), result: 'win' as const },
    { key: 'other', title: 'Players', players: players.filter(p => p.teamId !== 100 && p.teamId !== 200) },
  ].filter(g => g.players.length > 0)
}

/** One line per game: each team as a chip of champion portraits with its result. */
function Summary({ groups, catalog }: { groups: TeamGroup[]; catalog: LoadoutCatalog | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map(g => (
        <div key={g.key} className="flex items-center gap-1.5 rounded-md border px-1.5 py-1">
          <ResultBadge players={g.players} result={g.result} />
          {!g.result && <span className="text-[0.7rem] font-semibold text-muted-foreground uppercase">{g.title}</span>}
          <div className="flex gap-0.5">
            {g.players.map(p => <ChampionIcon key={p.puuid} player={p} catalog={catalog} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function Teams({ groups, catalog }: { groups: TeamGroup[]; catalog: LoadoutCatalog | null }) {
  const arena = groups.some(g => g.result === 'placement')
  return (
    <div className={arena ? 'grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4' : 'flex flex-wrap gap-4'}>
      {groups.map(g => <Team key={g.key} title={g.title} players={g.players} result={g.result} catalog={catalog} />)}
    </div>
  )
}

function GameCard({ game: g, catalog }: { game: PartyGame; catalog: LoadoutCatalog | null }) {
  const [expanded, setExpanded] = useState(false)
  const ql = queueLabel(g.queueId)
  const dur = duration(g.gameDuration)
  const groups = teamGroups(g.participants)

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
        {g.participants.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {expanded ? 'Less' : 'Details'}
            <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
      {g.participants.length > 0 ? (
        expanded ? <Teams groups={groups} catalog={catalog} /> : <Summary groups={groups} catalog={catalog} />
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
  const catalog = useLoadoutCatalog(games.some(g => g.participants.length > 0))
  if (games.length === 0) {
    return (
      <EmptyState icon={<Gamepad2 />} title="No games reported">
        When a party member runs the desktop client and starts a League game, it shows up here.
      </EmptyState>
    )
  }
  return (
    <div className="space-y-2.5">
      {games.map(g => <GameCard key={g.id} game={g} catalog={catalog} />)}
    </div>
  )
}
