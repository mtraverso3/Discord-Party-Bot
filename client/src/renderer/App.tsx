import {
  ArrowLeft, ChevronDown, Crown, Gamepad2, Link2, PartyPopper, Send, Settings as SettingsIcon,
  Swords, Tag as TagIcon, TriangleAlert, WifiOff, X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PartyBotBridge } from '../preload'
import type {
  AutoJoinSettings, ChampionPick, GameView, LcuStatus, LinkState, LobbyMode, LobbyRow, LobbyView, Session,
  SessionMember, TaggedPlayer,
} from '../shared/types'
import { LOBBY_MODES } from '../shared/types'
import { Avatar, Badge, Button, Card, EmptyState, Input, Select, StatusDot, Switch } from './ui'

declare global {
  interface Window { pb: PartyBotBridge }
}
const pb = window.pb

const EMPTY_LOBBY: LobbyView = { exists: false, rows: [], missing: [], intruders: 0 }
const EMPTY_GAME: GameView = { phase: 'none', byUserId: {}, byRiotId: {} }

function normalizeRiotId(riotId: string): string {
  return riotId.toLowerCase().replace(/\s+/g, ' ').trim()
}

/* ── Toast ── */

type ToastState = { id: number; message: string; kind: 'ok' | 'err' } | null

function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null
  return (
    <div
      key={toast.id}
      className={`animate-toast-in fixed bottom-4 left-1/2 z-50 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-4 py-2.5 text-[0.78rem] font-medium text-popover-foreground shadow-xl ${
        toast.kind === 'err' ? 'border-destructive/40 text-destructive' : ''
      }`}
    >
      {toast.message}
    </div>
  )
}

/* ── App state: polling the preload bridge ── */

function useToast() {
  const [toast, setToast] = useState<ToastState>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((message: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ id: Date.now(), message, kind })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 3500)
  }, [])
  return { toast, show }
}

export function App() {
  const [lcu, setLcu] = useState<LcuStatus>({ connected: false, summoner: null })
  const [link, setLink] = useState<LinkState>({ linked: false, botUrl: '' })
  const [session, setSession] = useState<Session | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [lobby, setLobby] = useState<LobbyView>(EMPTY_LOBBY)
  const [game, setGame] = useState<GameView>(EMPTY_GAME)
  const [autoJoin, setAutoJoin] = useState<AutoJoinSettings>({ enabled: false, targetName: '', inviteParty: false })
  const [tagged, setTagged] = useState<TaggedPlayer[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { toast, show } = useToast()

  // Latest values for the interval callbacks.
  const ref = useRef({ link, session, lcu })
  ref.current = { link, session, lcu }

  const refreshLobby = useCallback(async () => {
    const { link, session, lcu } = ref.current
    const active = link.linked && session?.party && lcu.connected
    if (!active) { setLobby(EMPTY_LOBBY); setGame(EMPTY_GAME); return }
    const [lobbyView, gameView] = await Promise.all([pb.lobbyStatus(), pb.gameChampions()])
    setLobby(lobbyView)
    setGame(gameView)
  }, [])

  const refreshSession = useCallback(async () => {
    if (!ref.current.link.linked) return
    const res = await pb.session()
    if (res.ok) {
      setSession(res.session as Session)
      ref.current.session = res.session as Session
      setSessionError(null)
    } else if (res.authExpired) {
      const l = await pb.linkState()
      setLink(l)
      ref.current.link = l
      setSession(null)
      ref.current.session = null
      setSessionError(null)
      show('Your link expired, link again with /party link', 'err')
    } else {
      setSessionError(res.error ?? 'PartyBot is unreachable.')
    }
  }, [show])

  useEffect(() => {
    let cancelled = false
    const refreshLcu = async () => {
      const v = await pb.lcuStatus()
      if (cancelled) return
      setLcu(v)
      ref.current.lcu = v
    }
    void (async () => {
      const l = await pb.linkState()
      if (cancelled) return
      setLink(l)
      ref.current.link = l
      await refreshLcu()
      await refreshSession()
      setTagged(await pb.tagsGet())
      await refreshLobby()
      setAutoJoin(await pb.autoJoinGet())
    })()
    const timers = [
      setInterval(() => { void refreshLcu() }, 3000),
      setInterval(() => { void refreshSession() }, 5000),
      setInterval(() => { void refreshLobby() }, 3000),
    ]
    return () => { cancelled = true; timers.forEach(clearInterval) }
  }, [refreshLobby, refreshSession])

  const setTagFor = useCallback((riotId: string, tagText: string) => {
    const trimmed = tagText.trim()
    setTagged(prev => {
      const rest = prev.filter(t => normalizeRiotId(t.riotId) !== normalizeRiotId(riotId))
      const next = trimmed ? [...rest, { riotId, tag: trimmed }] : rest
      void pb.tagsSet(next)
      return next
    })
    void refreshLobby() // reflect the new status in the live roster too
  }, [refreshLobby])

  const saveAutoJoin = useCallback((next: AutoJoinSettings) => {
    setAutoJoin(next)
    void pb.autoJoinSet(next)
  }, [])

  const screen = !link.linked ? 'link' : !session?.party ? 'no-party' : 'party'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-3 p-4">
        <Header lcu={lcu} link={link} settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen(o => !o)} />
        {settingsOpen ? (
          <SettingsPage tagged={tagged} setTagFor={setTagFor} showToast={show} />
        ) : (
          <>
            <AutoJoinCard autoJoin={autoJoin} onChange={saveAutoJoin} />
            {screen === 'link' && (
              <LinkScreen onLinked={async (name) => {
                const l = await pb.linkState()
                setLink(l)
                ref.current.link = l
                show(`Linked as ${name}`)
                void refreshSession()
              }} />
            )}
            {screen === 'no-party' && <NoPartyScreen sessionError={sessionError} />}
            {screen === 'party' && (
              <SquadCard
                session={session!} lcu={lcu} lobby={lobby} game={game}
                setTagFor={setTagFor} showToast={show} refreshLobby={refreshLobby}
              />
            )}
          </>
        )}
        <Footer link={link} onUnlinked={async () => {
          await pb.unlink()
          const l = await pb.linkState()
          setLink(l)
          ref.current.link = l
          setSession(null)
        }} />
      </div>
      <Toast toast={toast} />
    </div>
  )
}

/* ── Header / footer ── */

function StatusPill({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium whitespace-nowrap ${
      on ? 'border-transparent bg-success-muted text-success' : 'border-border bg-secondary text-muted-foreground'
    }`}>
      <StatusDot />
      <span className="truncate">{children}</span>
    </span>
  )
}

function Header({ lcu, link, settingsOpen, onToggleSettings }: {
  lcu: LcuStatus
  link: LinkState
  settingsOpen: boolean
  onToggleSettings: () => void
}) {
  return (
    <header className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Gamepad2 className="size-4" />
        </span>
        <h1 className="truncate text-[0.95rem] font-bold tracking-tight">{settingsOpen ? 'Settings' : 'PartyBot'}</h1>
      </div>
      <StatusPill on={lcu.connected}>
        {lcu.connected ? (lcu.summoner ? `${lcu.summoner.gameName}#${lcu.summoner.tagLine}` : 'League') : 'League offline'}
      </StatusPill>
      <StatusPill on={link.linked}>
        {link.linked ? (link.displayName ?? 'Linked') : 'Not linked'}
      </StatusPill>
      <Button variant="ghost" size="icon" title={settingsOpen ? 'Back' : 'Settings'} onClick={onToggleSettings}>
        {settingsOpen ? <ArrowLeft /> : <SettingsIcon />}
      </Button>
    </header>
  )
}

function Footer({ link, onUnlinked }: { link: LinkState; onUnlinked: () => void }) {
  return (
    <footer className="mt-auto flex items-center justify-between pt-1 text-[0.7rem] text-muted-foreground">
      <span className="truncate font-mono">{link.botUrl.replace(/^https?:\/\//, '')}</span>
      {link.linked && (
        <button
          className="shrink-0 cursor-pointer border-none bg-transparent p-1 font-sans text-[0.7rem] text-muted-foreground hover:text-destructive"
          onClick={onUnlinked}
        >
          Unlink account
        </button>
      )}
    </footer>
  )
}

/* ── Auto-join friend's lobby ── */

function AutoJoinCard({ autoJoin, onChange }: { autoJoin: AutoJoinSettings; onChange: (v: AutoJoinSettings) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <button
        className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <Swords className="size-4 text-muted-foreground" />
        Auto-join friend's lobby
        {autoJoin.enabled && <Badge variant="success"><StatusDot />on</Badge>}
        <ChevronDown className={`ml-auto size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 px-4 pt-0.5 pb-3.5">
          <p className="text-xs text-muted-foreground">
            When this friend opens a League lobby, the client joins it for you automatically.
          </p>
          <div className="flex items-center gap-3">
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[0.78rem] font-medium">
              <Switch checked={autoJoin.enabled} onCheckedChange={v => onChange({ ...autoJoin, enabled: v })} />
              Enabled
            </label>
            <Input
              placeholder="Friend Riot ID or name"
              defaultValue={autoJoin.targetName}
              onBlur={e => { if (e.target.value !== autoJoin.targetName) onChange({ ...autoJoin, targetName: e.target.value }) }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[0.78rem] font-medium">
            <Switch checked={autoJoin.inviteParty} onCheckedChange={v => onChange({ ...autoJoin, inviteParty: v })} />
            Invite my party after joining
          </label>
        </div>
      )}
    </Card>
  )
}

/* ── Link / empty screens ── */

function HeroCard({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <Card className="mt-[6vh] px-6 py-8 text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <p className="mb-1 text-[0.95rem] font-semibold tracking-tight">{title}</p>
      {children}
    </Card>
  )
}

function LinkScreen({ onLinked }: { onLinked: (displayName: string) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    const trimmed = code.trim().toUpperCase()
    if (trimmed.length !== 8) { setError('The code is 8 characters.'); return }
    setBusy(true)
    setError('')
    const res = await pb.linkAuth(trimmed)
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Linking failed.'); return }
    onLinked(res.displayName ?? 'you')
  }

  return (
    <HeroCard icon={<Link2 />} title="Link your Discord account">
      <p className="mb-4 text-xs text-muted-foreground">
        Run <b className="text-foreground">/party link</b> in Discord, then enter the code below. You only do this once.
      </p>
      <div className="mx-auto flex max-w-xs flex-col gap-2.5">
        <Input
          className="h-11 text-center font-mono text-base font-semibold tracking-[0.35em] uppercase"
          placeholder="LINK CODE"
          maxLength={8}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit() }}
        />
        <Button busy={busy} onClick={() => void submit()}>
          {!busy && <Link2 />}
          {busy ? 'Linking…' : 'Link account'}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </HeroCard>
  )
}

function NoPartyScreen({ sessionError }: { sessionError: string | null }) {
  return (
    <HeroCard
      icon={sessionError ? <WifiOff /> : <PartyPopper />}
      title={sessionError ? 'Connection problem' : 'No active party'}
    >
      <p className="text-xs text-muted-foreground">
        {sessionError ?? 'Join or create a party in Discord and it will show up here.'}
      </p>
    </HeroCard>
  )
}

/* ── The squad card: party roster and League lobby merged into one view ──
   Each person appears once; their League-lobby presence is a status on the
   row instead of a second list. Lobby-only players get their own section. */

function SquadCard({ session, lcu, lobby, game, setTagFor, showToast, refreshLobby }: {
  session: Session
  lcu: LcuStatus
  lobby: LobbyView
  game: GameView
  setTagFor: (riotId: string, tag: string) => void
  showToast: (msg: string, kind?: 'ok' | 'err') => void
  refreshLobby: () => Promise<void>
}) {
  const party = session.party!
  const inLobbyNames = new Set(lobby.rows.filter(r => r.status === 'party').map(r => r.displayName))
  const inLobbyCount = party.members.filter(m => m.userId === session.userId || inLobbyNames.has(m.displayName)).length
  const guests = lobby.rows.filter(r => r.status === 'tagged' || r.status === 'intruder')

  return (
    <Card>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight">{party.name}</h2>
          <p className="text-xs text-muted-foreground">{party.members.length} of {party.maxSize} members</p>
        </div>
        <Badge variant="outline" className="max-w-full">{party.game}</Badge>
      </div>

      {/* League-lobby status strip */}
      <div className="flex items-center gap-2 border-y bg-muted/40 px-4 py-2 text-xs">
        <StatusDot className={lobby.exists || game.phase !== 'none' ? 'text-success' : 'text-muted-foreground'} />
        <span className={lobby.exists || game.phase !== 'none' ? 'text-foreground' : 'text-muted-foreground'}>
          {!lcu.connected ? 'League client offline'
            : game.phase === 'in-game' ? 'Game in progress — champion picks below'
            : game.phase === 'champ-select' ? 'Champion select — picks below'
            : lobby.exists ? `League lobby open — ${inLobbyCount} of ${party.members.length} members in`
            : 'No League lobby open'}
        </span>
      </div>

      {/* Members */}
      <div className="flex flex-col px-4 py-1">
        {party.members.map(m => (
          <MemberRow key={m.userId} member={m} isSelf={m.userId === session.userId}
            lobbyExists={lobby.exists} champion={game.byUserId[m.userId] ?? null}
            inLobby={m.userId === session.userId || inLobbyNames.has(m.displayName)} />
        ))}
      </div>

      {/* Lobby-only players */}
      {lobby.exists && guests.length > 0 && (
        <div className="border-t px-4 pt-2.5 pb-1">
          <div className="flex items-center gap-2 pb-1">
            <p className="text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">Also in your lobby</p>
            {lobby.intruders > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 text-[0.7rem] font-medium text-destructive">
                <TriangleAlert className="size-3.5" />
                {lobby.intruders} not in the party
              </span>
            )}
          </div>
          {guests.map(r => (
            <GuestRow key={r.riotId} row={r} champion={game.byRiotId[normalizeRiotId(r.riotId)] ?? null}
              setTagFor={setTagFor} showToast={showToast} />
          ))}
        </div>
      )}

      {/* Invite action */}
      {session.canInvite && (
        <InviteBar lcu={lcu} lobby={lobby} showToast={showToast} refreshLobby={refreshLobby} />
      )}
    </Card>
  )
}

/* A champion pick chip: square portrait + name. Falls back to just the name
   when Data Dragon didn't resolve an icon. */
function ChampionBadge({ champion }: { champion: ChampionPick }) {
  return (
    <Badge variant="secondary" className="max-w-36 gap-1.5 pl-1" title={`Picked ${champion.name}`}>
      {champion.iconUrl && (
        <img src={champion.iconUrl} alt="" className="size-4 shrink-0 rounded-full object-cover" />
      )}
      <span className="truncate">{champion.name}</span>
    </Badge>
  )
}

function MemberRow({ member: m, isSelf, lobbyExists, inLobby, champion }: {
  member: SessionMember
  isSelf: boolean
  lobbyExists: boolean
  inLobby: boolean
  champion: ChampionPick | null
}) {
  // Champion pick takes precedence over lobby presence — it's the more specific
  // signal once a game is underway. One status chip per row otherwise.
  const chip = champion ? <ChampionBadge champion={champion} />
    : !m.ign ? <Badge variant="warning">no IGN</Badge>
    : lobbyExists ? (inLobby ? <Badge variant="success"><StatusDot />in lobby</Badge> : <Badge variant="outline">not in lobby</Badge>)
    : null

  return (
    <div className="flex items-center gap-2.5 border-b py-2 last:border-b-0">
      <Avatar name={m.displayName} highlight={isSelf} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[0.8rem] font-medium">
          <span className="truncate">{m.displayName}{isSelf ? ' (you)' : ''}</span>
          {m.isOwner && <Crown className="size-3.5 shrink-0 text-warning" aria-label="Party owner" />}
        </p>
        <p className="truncate text-[0.7rem] text-muted-foreground">
          {m.ign ?? 'No IGN — set with /party ign in Discord'}
        </p>
      </div>
      {chip}
    </div>
  )
}

function GuestRow({ row: r, champion, setTagFor, showToast }: {
  row: LobbyRow
  champion: ChampionPick | null
  setTagFor: (riotId: string, tag: string) => void
  showToast: (msg: string, kind?: 'ok' | 'err') => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const save = () => {
    setEditing(false)
    setTagFor(r.riotId, value)
    showToast(value.trim() ? `Tagged ${r.riotId} as “${value.trim()}”` : `Removed tag for ${r.riotId}`)
  }

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center gap-2.5 py-2">
        <Avatar name={r.riotId} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8rem] font-medium">{r.riotId}</p>
          {r.known && <p className="truncate text-[0.7rem] text-muted-foreground">{r.known.displayName} on Discord</p>}
        </div>
        {champion && <ChampionBadge champion={champion} />}
        {r.status === 'tagged'
          ? <Badge variant="secondary">{r.tag}</Badge>
          : <Badge variant="destructive">not in party</Badge>}
        <Button
          variant="ghost" size="icon"
          title={editing ? 'Close tag editor' : r.status === 'tagged' ? 'Edit tag' : 'Tag this player as someone you know'}
          onClick={() => { setValue(r.tag ?? ''); setEditing(e => !e) }}
        >
          {editing ? <X /> : <TagIcon />}
        </Button>
      </div>
      {editing && (
        <div className="flex items-center gap-2 pb-2.5 pl-[42px]">
          <Input
            className="h-8 text-xs"
            placeholder="Label (e.g. coach, friend) — empty removes"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save() }}
          />
          <Button size="sm" onClick={save}>Save</Button>
        </div>
      )}
    </div>
  )
}

function InviteBar({ lcu, lobby, showToast, refreshLobby }: {
  lcu: LcuStatus
  lobby: LobbyView
  showToast: (msg: string, kind?: 'ok' | 'err') => void
  refreshLobby: () => Promise<void>
}) {
  const [mode, setMode] = useState<LobbyMode>('custom-draft')
  const [busy, setBusy] = useState(false)

  async function invite() {
    setBusy(true)
    const res = await pb.createLobbyAndInvite(mode)
    setBusy(false)
    if (!res.ok) {
      showToast(res.error ?? 'Invite failed', 'err')
    } else {
      const sent = res.outcomes.filter(o => o.status === 'invited').length
      const skipped = res.outcomes.filter(o => o.status === 'no-ign' || o.status === 'not-found')
      showToast(`${res.createdNew ? 'Lobby created' : 'Invited to your lobby'}, ${sent} invite${sent === 1 ? '' : 's'} sent` +
        (skipped.length ? `, ${skipped.length} skipped (no/invalid IGN)` : ''))
    }
    void refreshLobby()
  }

  return (
    <div className="flex flex-col gap-2 border-t bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* The mode picker only matters when a lobby has to be created. */}
        {!lobby.exists && (
          <Select className="w-auto min-w-0 flex-1" value={mode} onChange={e => setMode(e.target.value as LobbyMode)}>
            {LOBBY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        )}
        <Button className={lobby.exists ? 'w-full' : ''} disabled={!lcu.connected} busy={busy} onClick={() => void invite()}>
          {!busy && <Send />}
          {busy ? 'Inviting…' : lobby.exists ? 'Invite all to this lobby' : 'Create lobby & invite all'}
        </Button>
      </div>
      <p className="text-[0.7rem] text-muted-foreground">
        {!lcu.connected ? 'Start the League client to create a lobby.'
          : lobby.exists ? 'Invites every member into the lobby you are in now.'
          : 'Creates the lobby on your League client and invites every member by their IGN.'}
      </p>
    </div>
  )
}

/* ── Settings ── */

function SettingsPage({ tagged, setTagFor, showToast }: {
  tagged: TaggedPlayer[]
  setTagFor: (riotId: string, tag: string) => void
  showToast: (msg: string, kind?: 'ok' | 'err') => void
}) {
  const [riotId, setRiotId] = useState('')
  const [label, setLabel] = useState('')

  const add = () => {
    const id = riotId.trim()
    const tag = label.trim()
    if (!id || !tag) { showToast('Enter a Riot ID and a label', 'err'); return }
    setRiotId('')
    setLabel('')
    setTagFor(id, tag)
    showToast(`Tagged ${id} as “${tag}”`)
  }

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <TagIcon className="size-4 text-muted-foreground" />
        Lobby tags
      </h2>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
        Give lobby-only players you recognize a label of your own choosing. They'll still
        show up in the lobby list, just excluded from the "not in party" alert.
      </p>
      <div className="mb-3 flex flex-col gap-2">
        <Input placeholder="Riot ID (e.g. Faker#KR1)" value={riotId} onChange={e => setRiotId(e.target.value)} />
        <div className="flex gap-2">
          <Input placeholder="Label (e.g. coach, friend)" value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }} />
          <Button onClick={add}><TagIcon />Add</Button>
        </div>
      </div>
      {tagged.length > 0 ? (
        <div className="flex flex-col">
          {tagged.map(t => (
            <div key={t.riotId} className="flex items-center gap-2.5 border-b py-2 last:border-b-0">
              <Avatar name={t.riotId} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8rem] font-medium">{t.riotId}</p>
                <p className="truncate text-[0.7rem] text-muted-foreground">{t.tag}</p>
              </div>
              <button
                className="shrink-0 cursor-pointer border-none bg-transparent p-1 text-[0.72rem] text-muted-foreground hover:text-destructive"
                onClick={() => { setTagFor(t.riotId, ''); showToast(`Removed tag for ${t.riotId}`) }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={<TagIcon />} title="No tagged players yet." />
      )}
    </Card>
  )
}
