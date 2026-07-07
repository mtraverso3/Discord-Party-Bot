import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import {
  discoverLcu, fetchChampSelectPicks, fetchFriends, fetchGameflowPhase, fetchRegion, lcuRequest,
  type LcuCreds,
} from './lcu'
import {
  addToParty, clearLink, fetchChampionCatalog, fetchLiveChampions, fetchSession, getAutoJoinSettings,
  getTaggedPlayers, linkState, linkWithCode, lookupPlayers, setAutoJoinSettings, setPartyGame,
  setTaggedPlayers, type ChampionCatalog,
} from './bot'
import { crossReference, formatRiotId, parseRiotId, type LobbyEntry, type PartyEntry } from '../shared/match'
import type {
  AutoJoinSettings, ChampionPick, GamePhase, GameView, InviteOutcome, InviteResult, LcuStatus, LobbyMode,
  LobbyView, Session, SessionResult, SummonerInfo, TaggedPlayer,
} from '../shared/types'

// ── LCU connection state ─────────────────────────────────────────────────────

let creds: LcuCreds | null = null
let summoner: SummonerInfo | null = null
let region: string | null = null // Riot Client region code, e.g. "NA" — stable for the connection

// Riot ID lookups are stable for the lifetime of a client connection.
const ignCache = new Map<string, { puuid: string; summonerId: number } | null>()
const puuidNameCache = new Map<string, { gameName: string; tagLine: string }>()

async function pollLcu(): Promise<void> {
  if (!creds) {
    const found = await discoverLcu()
    if (!found) return
    creds = found
    ignCache.clear()
    puuidNameCache.clear()
    region = null
  }
  try {
    const res = await lcuRequest(creds, 'GET', '/lol-summoner/v1/current-summoner')
    if (res.status === 200 && res.body?.puuid) {
      summoner = {
        summonerId: res.body.summonerId,
        puuid: res.body.puuid,
        gameName: res.body.gameName || res.body.displayName || 'Summoner',
        tagLine: res.body.tagLine || '',
      }
      if (region === null) region = await fetchRegion(creds)
      return
    }
  } catch { /* client gone */ }
  creds = null
  summoner = null
  region = null
}

setInterval(() => { void pollLcu() }, 3000)
void pollLcu()

// ── Auto-switch the party's game to match the connected LoL account's region ──

// Keys match /riotclient/region-locale's own short region codes (e.g. "NA"),
// not LCU platform ids (e.g. "NA1") — those are a different naming scheme.
const REGION_GAME: Record<string, string> = {
  NA: 'LoL NA',
  EUW: 'LoL EUW',
  PBE: 'LoL PBE',
}

let autoSwitchRetryAt = 0 // backoff after a failed attempt, so failures don't spam every poll
let switchingGame = false // in-flight guard: a slow request shouldn't overlap the next poll's attempt

async function maybeAutoSwitchGame(): Promise<void> {
  if (!region || switchingGame) return
  const mapped = REGION_GAME[region]
  if (!mapped) return

  const party = lastSession?.party
  if (!party || !party.isOwner || party.game === mapped) return
  if (Date.now() < autoSwitchRetryAt) return

  switchingGame = true
  try {
    const res = await setPartyGame(mapped)
    if (res.ok) {
      party.game = mapped // optimistic; the next session poll confirms it
    } else {
      autoSwitchRetryAt = Date.now() + 30_000
    }
  } finally {
    switchingGame = false
  }
}

// ── Friend-list auto-join ────────────────────────────────────────────────────
//
// The League client's friends list shows a "Join" option next to a friend
// when they have an open/joinable lobby. That's powered by the friend's
// `lol.pty` field — a JSON-encoded string (confirmed live) shaped like:
//   { partyId, queueId, isPartyOpen, maxPlayers, summonerPuuids, summoners }
// `lol.ptyType === "open"` mirrors `isPartyOpen`. Joining calls
// POST /lol-lobby/v2/party/{partyId}/join (confirmed against the LCU swagger
// spec — undocumented in the usual community LCU references).

let joiningParty = false

// Cooldown after any join attempt (success or failure) — just long enough
// for the friend's presence to reflect our membership, not a permanent
// "already handled" flag. Leaving the lobby (on purpose or by disconnect)
// gets us auto-joined right back in once this window passes and their
// party is still open. Also used to space out the extra invite retries below.
const RETRY_INTERVAL_MS = 10_000
let joinRetryAt = 0

// After a successful join, invite attempts are retried a couple more times on
// the same interval — the first invite can fire before the LCU has fully
// registered our membership in the lobby, so a bare one-shot attempt can
// silently miss.
const EXTRA_INVITE_ATTEMPTS = 2
let inviteAttemptsRemaining = 0
let nextInviteAttemptAt = 0

function friendMatches(friend: any, targetName: string): boolean {
  const target = targetName.trim().toLowerCase()
  if (!target) return false
  const candidates: unknown[] = [
    friend?.name, friend?.gameName, friend?.summonerName,
    friend?.gameName && friend?.gameTag ? `${friend.gameName}#${friend.gameTag}` : null,
    friend?.gameName && friend?.tagLine ? `${friend.gameName}#${friend.tagLine}` : null,
  ]
  return candidates.some(c => typeof c === 'string' && c.trim().toLowerCase() === target)
}

interface FriendPartyInfo {
  partyId: string
  isPartyOpen: boolean
  summonerPuuids: string[]
}

function parseFriendParty(friend: any): FriendPartyInfo | null {
  const raw = friend?.lol?.pty
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed.partyId !== 'string') return null
    return {
      partyId: parsed.partyId,
      isPartyOpen: !!parsed.isPartyOpen,
      summonerPuuids: Array.isArray(parsed.summonerPuuids) ? parsed.summonerPuuids : [],
    }
  } catch {
    return null
  }
}

async function pollAutoJoin(): Promise<void> {
  if (!creds) return
  const settings = getAutoJoinSettings()
  if (!settings.enabled || !settings.targetName.trim()) return

  const friends = await fetchFriends(creds)
  const friend = friends.find(f => friendMatches(f, settings.targetName)) ?? null
  if (!friend) return

  const party = parseFriendParty(friend)
  if (!party || !party.isPartyOpen) return

  if (summoner && party.summonerPuuids.includes(summoner.puuid)) {
    // Already in it — fire the remaining follow-up invite retries, if any.
    if (settings.inviteParty && inviteAttemptsRemaining > 0 && Date.now() >= nextInviteAttemptAt) {
      inviteAttemptsRemaining--
      nextInviteAttemptAt = Date.now() + RETRY_INTERVAL_MS
      void inviteAllToCurrentLobby(false).catch(() => {})
    }
    return
  }

  if (joiningParty || Date.now() < joinRetryAt) return

  joiningParty = true
  try {
    const res = await lcuRequest(creds, 'POST', `/lol-lobby/v2/party/${party.partyId}/join`, {})
    if (res.status >= 200 && res.status < 300 && settings.inviteParty) {
      inviteAttemptsRemaining = EXTRA_INVITE_ATTEMPTS
      nextInviteAttemptAt = Date.now() + RETRY_INTERVAL_MS
      void inviteAllToCurrentLobby(false).catch(() => {})
    }
  } catch { /* retried next cooldown window regardless */ } finally {
    joinRetryAt = Date.now() + RETRY_INTERVAL_MS
    joiningParty = false
  }
}

setInterval(() => { void pollAutoJoin() }, 5000)

// ── Session cache (main is authoritative; renderer only renders) ────────────

let lastSession: Session | null = null

// ── Riot ID resolution via the local client ─────────────────────────────────

async function resolveIgn(ign: string): Promise<{ puuid: string; summonerId: number } | null> {
  if (!creds) return null
  const key = ign.toLowerCase().replace(/\s+/g, ' ').trim()
  if (ignCache.has(key)) return ignCache.get(key)!

  const parsed = parseRiotId(ign)
  let result: { puuid: string; summonerId: number } | null = null
  if (parsed) {
    // Tagline-less IGNs default to the local player's tagline (same region).
    const tag = parsed.tag ?? summoner?.tagLine ?? ''
    try {
      const alias = await lcuRequest(
        creds, 'GET',
        `/lol-summoner/v1/alias/lookup?gameName=${encodeURIComponent(parsed.name)}&tagLine=${encodeURIComponent(tag)}`,
      )
      const puuid: string | undefined = alias.body?.puuid
      if (alias.status === 200 && puuid) {
        const summ = await lcuRequest(creds, 'GET', `/lol-summoner/v2/summoners/puuid/${puuid}`)
        if (summ.status === 200 && summ.body?.summonerId) {
          result = { puuid, summonerId: summ.body.summonerId }
        }
      }
    } catch { /* lookup failed; treat as unresolved */ }
  }
  ignCache.set(key, result)
  return result
}

async function riotIdForPuuid(puuid: string): Promise<{ gameName: string; tagLine: string }> {
  const cached = puuidNameCache.get(puuid)
  if (cached) return cached
  let out = { gameName: 'Unknown', tagLine: '' }
  if (creds) {
    try {
      const res = await lcuRequest(creds, 'GET', `/lol-summoner/v2/summoners/puuid/${puuid}`)
      if (res.status === 200 && res.body?.gameName) {
        out = { gameName: res.body.gameName, tagLine: res.body.tagLine ?? '' }
      }
    } catch { /* leave as Unknown */ }
  }
  puuidNameCache.set(puuid, out)
  return out
}

// ── Lobby creation + invites ─────────────────────────────────────────────────

function lobbyPayload(mode: LobbyMode, partyName: string): unknown {
  const custom = (mutatorId: number) => ({
    customGameLobby: {
      configuration: {
        gameMode: 'CLASSIC', gameMutator: '', gameServerRegion: '', mapId: 11,
        mutators: { id: mutatorId }, spectatorPolicy: 'AllAllowed', teamSize: 5,
      },
      lobbyName: partyName.slice(0, 32) || 'PartyBot Lobby',
      lobbyPassword: '',
    },
    isCustom: true,
  })
  switch (mode) {
    case 'custom-draft': return custom(6)   // tournament draft
    case 'custom-blind': return custom(1)
    case 'arena': return { queueId: 1700 }
    case 'aram': return { queueId: 450 }
    case 'normal-draft': return { queueId: 400 }
  }
}

// Sends invitations to every other party member into whatever lobby the
// client is currently in — does not create or check for one, so it's safe to
// call right after joining someone else's lobby (unlike createLobbyAndInviteAll,
// this never falls back to creating a new one).
async function inviteAllToCurrentLobby(createdNew: boolean): Promise<InviteResult> {
  if (!creds || !summoner) return { ok: false, error: 'League client is not connected.', outcomes: [] }
  const party = lastSession?.party
  if (!party) return { ok: false, error: 'You are not in a party.', outcomes: [] }
  if (!lastSession?.canInvite) return { ok: false, error: 'You are not allowed to invite for this party.', outcomes: [] }

  const outcomes: InviteOutcome[] = []
  const invites: { toSummonerId: number }[] = []

  for (const m of party.members) {
    if (m.userId === lastSession!.userId) {
      outcomes.push({ displayName: m.displayName, ign: m.ign, status: 'self' })
      continue
    }
    if (!m.ign) {
      outcomes.push({ displayName: m.displayName, ign: null, status: 'no-ign' })
      continue
    }
    const resolved = await resolveIgn(m.ign)
    if (!resolved) {
      outcomes.push({ displayName: m.displayName, ign: m.ign, status: 'not-found' })
      continue
    }
    if (resolved.puuid === summoner.puuid) {
      outcomes.push({ displayName: m.displayName, ign: m.ign, status: 'self' })
      continue
    }
    invites.push({ toSummonerId: resolved.summonerId })
    outcomes.push({ displayName: m.displayName, ign: m.ign, status: 'invited' })
  }

  if (invites.length > 0) {
    const sent = await lcuRequest(creds, 'POST', '/lol-lobby/v2/lobby/invitations', invites)
      .catch(() => ({ status: 0, body: null }))
    if (sent.status >= 400 || sent.status === 0) {
      for (const o of outcomes) if (o.status === 'invited') o.status = 'failed'
      return { ok: false, error: `Lobby ${createdNew ? 'created' : 'found'}, but invitations failed (LCU ${sent.status}).`, outcomes }
    }
  }

  return { ok: true, createdNew, outcomes }
}

async function createLobbyAndInviteAll(mode: LobbyMode): Promise<InviteResult> {
  if (!creds) return { ok: false, error: 'League client is not connected.', outcomes: [] }
  const party = lastSession?.party
  if (!party) return { ok: false, error: 'You are not in a party.', outcomes: [] }

  // Invite into the lobby the leader is already in, if any; only create a
  // fresh one when there is none (creating would replace the current lobby).
  let createdNew = false
  const existing = await lcuRequest(creds, 'GET', '/lol-lobby/v2/lobby')
    .catch(() => ({ status: 0, body: null }))
  if (existing.status !== 200) {
    const create = await lcuRequest(creds, 'POST', '/lol-lobby/v2/lobby', lobbyPayload(mode, party.name))
      .catch(() => ({ status: 0, body: null }))
    if (create.status >= 400 || create.status === 0) {
      return { ok: false, error: `Could not create the lobby (LCU ${create.status}).`, outcomes: [] }
    }
    createdNew = true
  }

  return inviteAllToCurrentLobby(createdNew)
}

// ── Lobby cross-reference ────────────────────────────────────────────────────

async function lobbyStatus(): Promise<LobbyView> {
  const none: LobbyView = { exists: false, rows: [], missing: [], intruders: 0 }
  if (!creds) return none
  const party = lastSession?.party
  if (!party) return none

  const res = await lcuRequest(creds, 'GET', '/lol-lobby/v2/lobby').catch(() => ({ status: 0, body: null }))
  if (res.status !== 200 || !Array.isArray(res.body?.members)) return none

  const lobby: LobbyEntry[] = await Promise.all(
    res.body.members.map(async (m: any): Promise<LobbyEntry> => {
      let gameName: string = m.gameName || ''
      let tagLine: string = m.tagLine || ''
      if (!gameName && m.puuid) {
        const resolved = await riotIdForPuuid(m.puuid)
        gameName = resolved.gameName
        tagLine = resolved.tagLine
      }
      return { puuid: m.puuid ?? '', gameName: gameName || 'Unknown', tagLine, isLeader: !!m.isLeader }
    }),
  )

  const roster: PartyEntry[] = await Promise.all(
    party.members.map(async (m): Promise<PartyEntry> => ({
      userId: m.userId,
      displayName: m.displayName,
      ign: m.ign,
      puuid: m.ign ? (await resolveIgn(m.ign))?.puuid ?? null : null,
    })),
  )

  const view = crossReference(roster, lobby, lastSession?.userId ?? null, summoner?.puuid ?? null, getTaggedPlayers())

  // Recognize intruders who are registered PartyBot users, so the UI can show
  // their Discord tag and offer to add them instead of just flagging them.
  const intruderIds = view.rows.filter(r => r.status === 'intruder').map(r => r.riotId)
  if (intruderIds.length > 0) {
    const known = await lookupPlayers(intruderIds)
    for (const row of view.rows) {
      if (row.status === 'intruder') row.known = known[row.riotId] ?? null
    }
  }

  return view
}

// ── Champion picks (champ select + live game) ────────────────────────────────

// The Data Dragon catalog is stable for a patch; fetch it once per app run and
// reuse it to turn numeric championIds into names + icons.
let championCatalog: ChampionCatalog | null = null

async function ensureCatalog(): Promise<ChampionCatalog | null> {
  if (!championCatalog) championCatalog = await fetchChampionCatalog()
  return championCatalog
}

function normalizeRiotId(riotId: string): string {
  return riotId.toLowerCase().replace(/\s+/g, ' ').trim()
}

const EMPTY_GAME: GameView = { phase: 'none', byUserId: {}, byRiotId: {} }

/**
 * Champion picks for the party's current champ select or live game.
 *
 * The local champ-select session is the primary source — it covers every lobby
 * type (customs included) and updates live as members lock in. Once the match
 * actually starts the session is gone, so for matchmade games we fall back to
 * the Worker's Spectator-backed lookup keyed by the leader's puuid.
 */
async function gameChampions(): Promise<GameView> {
  if (!creds) return EMPTY_GAME
  const party = lastSession?.party
  if (!party) return EMPTY_GAME

  const phase = await fetchGameflowPhase(creds)

  // Merge picks from both sources, keyed by puuid. Live-game data wins since
  // it reflects the final locked champion.
  const byPuuid = new Map<string, number>()
  for (const p of await fetchChampSelectPicks(creds)) byPuuid.set(p.puuid, p.championId)

  if (phase === 'InProgress' && summoner) {
    const live = await fetchLiveChampions(region ?? '', summoner.puuid)
    for (const p of live.participants) byPuuid.set(p.puuid, p.championId)
  }

  if (byPuuid.size === 0) {
    return { ...EMPTY_GAME, phase: phase === 'InProgress' ? 'in-game' : phase === 'ChampSelect' ? 'champ-select' : 'none' }
  }

  const catalog = await ensureCatalog()
  const pickFor = (championId: number): ChampionPick => {
    const info = catalog?.champions[String(championId)]
    return { championId, name: info?.name ?? `Champion ${championId}`, iconUrl: info?.iconUrl ?? null }
  }

  // Party members: match by their resolved puuid.
  const byUserId: Record<string, ChampionPick> = {}
  const claimedPuuids = new Set<string>()
  await Promise.all(party.members.map(async (m) => {
    if (!m.ign) return
    const resolved = await resolveIgn(m.ign)
    if (!resolved) return
    const championId = byPuuid.get(resolved.puuid)
    if (championId !== undefined) {
      byUserId[m.userId] = pickFor(championId)
      claimedPuuids.add(resolved.puuid)
    }
  }))

  // Everyone else in the game/lobby: expose by (normalized) Riot ID so the
  // renderer can annotate lobby guests too.
  const byRiotId: Record<string, ChampionPick> = {}
  await Promise.all([...byPuuid.entries()].map(async ([puuid, championId]) => {
    if (claimedPuuids.has(puuid)) return
    const name = await riotIdForPuuid(puuid)
    byRiotId[normalizeRiotId(formatRiotId(name.gameName, name.tagLine))] = pickFor(championId)
  }))

  const phaseOut: GamePhase = phase === 'InProgress' ? 'in-game' : 'champ-select'
  return { phase: phaseOut, byUserId, byRiotId }
}

// ── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle('lcu:status', (): LcuStatus => ({ connected: creds !== null, summoner }))
ipcMain.handle('link:state', () => linkState())
ipcMain.handle('link:auth', (_e, code: string) => linkWithCode(String(code ?? '')))
ipcMain.handle('link:logout', () => { clearLink(); lastSession = null })
ipcMain.handle('session:get', async (): Promise<SessionResult> => {
  const result = await fetchSession()
  lastSession = result.ok ? (result.session as Session) : null
  void maybeAutoSwitchGame()
  return result as SessionResult
})
ipcMain.handle('lobby:create-invite', (_e, mode: LobbyMode) => createLobbyAndInviteAll(mode))
ipcMain.handle('lobby:status', () => lobbyStatus())
ipcMain.handle('game:champions', () => gameChampions())
ipcMain.handle('party:add', async (_e, userId: string) => {
  const res = await addToParty(String(userId ?? ''))
  if (res.ok) await fetchSession().then(r => { if (r.ok) lastSession = r.session as Session })
  return res
})
ipcMain.handle('autojoin:get', (): AutoJoinSettings => getAutoJoinSettings())
ipcMain.handle('autojoin:set', (_e, settings: AutoJoinSettings) => setAutoJoinSettings(settings))
ipcMain.handle('tags:get', (): TaggedPlayer[] => getTaggedPlayers())
ipcMain.handle('tags:set', (_e, players: TaggedPlayer[]) => setTaggedPlayers(players))

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  const win = new BrowserWindow({
    width: 460,
    height: 700,
    minWidth: 420,
    minHeight: 560,
    title: 'PartyBot',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  Menu.setApplicationMenu(null)
  // Open any external links in the default browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadFile(join(__dirname, 'index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
