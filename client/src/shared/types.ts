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
  assignedBan: string | null  // champion this member was assigned to ban (/party banlist)
  avatarUrl: string | null    // Discord avatar CDN URL, or null for a default avatar
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

/** Whether a member banned the champion they were assigned. `actual` is the
 *  champion they actually banned (null until they've banned during the ban
 *  phase); `ok` is true when it matches `assigned`. Only present during champ
 *  select — per-player ban attribution isn't available once the game starts. */
export interface BanCheck {
  assigned: string             // champion the member was told to ban
  assignedIcon: string | null  // icon for `assigned`, when resolvable
  actual: string | null        // champion they actually banned (null until banned / when inferred-miss)
  actualIcon: string | null    // icon for `actual`, when known
  ok: boolean                  // assigned was banned
  inferred: boolean            // true when derived from ban presence, not confirmed by caster
                               // (the client can't identify who cast non-group bans)
}

/** Champion picks for the current champ select or live game, cross-referenced
 *  against the party. `byUserId` covers party members; `byRiotId` (normalized,
 *  lowercase "name#tag") covers everyone else in the game/lobby. `bansByUserId`
 *  reports each assigned member's ban vs. what they actually banned. */
export interface GameView {
  phase: GamePhase
  byUserId: Record<string, ChampionPick>
  byRiotId: Record<string, ChampionPick>
  bansByUserId: Record<string, BanCheck>
}
