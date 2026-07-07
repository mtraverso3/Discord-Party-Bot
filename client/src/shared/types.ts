// Types shared between the Electron main process and the renderer.

export interface SummonerInfo {
  summonerId: number
  puuid: string
  gameName: string
  tagLine: string
}

export interface LcuStatus {
  connected: boolean
  summoner: SummonerInfo | null
}

export interface LinkState {
  linked: boolean
  displayName?: string
  userId?: string
  botUrl: string
}

export interface SessionMember {
  userId: string
  displayName: string
  ign: string | null
  isOwner: boolean
}

export interface SessionParty {
  id: string
  name: string
  game: string
  maxSize: number
  isOwner: boolean
  members: SessionMember[]
}

export interface Session {
  userId: string
  displayName: string
  guildId: string
  canInvite: boolean
  party: SessionParty | null
}

export interface SessionResult {
  ok: boolean
  authExpired?: boolean
  error?: string
  session?: Session
}

export type LobbyMode = 'custom-draft' | 'custom-blind' | 'arena' | 'aram' | 'normal-draft'

export const LOBBY_MODES: { value: LobbyMode; label: string }[] = [
  { value: 'custom-draft', label: 'Custom: Tournament Draft' },
  { value: 'custom-blind', label: 'Custom: Blind Pick' },
  { value: 'arena', label: 'Arena' },
  { value: 'aram', label: 'ARAM' },
  { value: 'normal-draft', label: 'Normal: Draft Pick' },
]

export type InviteStatus = 'invited' | 'self' | 'no-ign' | 'not-found' | 'failed'

export interface InviteOutcome {
  displayName: string
  ign: string | null
  status: InviteStatus
}

export interface InviteResult {
  ok: boolean
  error?: string
  createdNew?: boolean  // false when invites went to the leader's existing lobby
  outcomes: InviteOutcome[]
}

export type LobbySlotStatus = 'you' | 'party' | 'tagged' | 'intruder'

export interface LobbyRow {
  riotId: string
  isLeader: boolean
  status: LobbySlotStatus
  displayName: string | null  // party display name when matched
  tag: string | null          // user-set custom label, when status is 'tagged'
  known: KnownPlayer | null   // set for intruders who are a registered Discord user (looked up async)
}

/** A lobby intruder recognized as a registered Discord user, keyed by riotId. */
export interface KnownPlayer {
  userId: string
  displayName: string
}

export interface LobbyView {
  exists: boolean
  rows: LobbyRow[]
  missing: { displayName: string; ign: string | null }[]
  intruders: number
}

/** A lobby-only player the user recognizes and wants to stop being flagged as
 *  an intruder — still shown in the lobby list, just under their own label. */
export interface TaggedPlayer {
  riotId: string  // Riot ID as entered by the user, e.g. "Faker#KR1" (tagline optional)
  tag: string      // custom label shown in place of "NOT IN PARTY", e.g. "smurf", "coach"
}

export interface AutoJoinSettings {
  enabled: boolean
  targetName: string
  inviteParty: boolean
}

/** A champion a player has picked/locked, resolved to a display name + icon. */
export interface ChampionPick {
  championId: number
  name: string
  iconUrl: string | null
}

export type GamePhase = 'none' | 'champ-select' | 'in-game'

/** Champion picks for the current champ select or live game, cross-referenced
 *  against the party. `byUserId` covers party members; `byRiotId` (normalized,
 *  lowercase "name#tag") covers everyone else in the game/lobby. */
export interface GameView {
  phase: GamePhase
  byUserId: Record<string, ChampionPick>
  byRiotId: Record<string, ChampionPick>
}
