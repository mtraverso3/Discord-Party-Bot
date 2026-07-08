// Wire types for /admin/api — mirrors the shapes in ../../src/types.ts without
// pulling in the Worker-side bindings.

export interface PartyMember {
  userId: string
  username: string
  displayName: string
  ign?: string
  away?: boolean
  joinedAt: number
}

export interface QueueEntry {
  userId: string
  username: string
  displayName: string
  ign?: string
  queuedAt: number
}

export interface BanList {
  source: string[]
  pool: string[]
  assignments: Record<string, string>
}

export interface Party {
  id: string
  guildId: string
  name: string
  description: string
  game: string
  ownerId: string
  ownerName: string
  maxSize: number
  voiceChannelId?: string
  isClosed: boolean
  embedMessageId?: string
  embedChannelId?: string
  createdAt: number
  lastActivityAt?: number
  members: PartyMember[]
  queue: QueueEntry[]
  banlist?: BanList
}

export interface PartyTemplate {
  id: string
  label: string
  name: string
  description: string
  game: string
  maxSize: number
  voiceChannelId?: string
  banlist?: string
  createdAt: number
  updatedAt: number
}

export interface GuildSettings {
  maxParties: number
  defaultCap: number
  allowedGames: string[]
  clientInviters: string[]
  partyBumpers: string[]
}

export interface GuildInfo {
  id: string
  name: string
  icon?: string | null
}

export interface ChannelInfo {
  id: string
  name: string
}

export interface MemberHit {
  id: string
  username: string
  displayName: string
}

export interface AuditEntry {
  ts: number
  email?: string
  method: string
  path: string
}

export interface UserLookup {
  userId: string
  profile: { igns: Record<string, string> }
  partyId: string | null
  partyExists: boolean
  inParty: boolean
  member: { username: string; displayName: string } | null
}

export interface UserNote {
  id: number
  body: string
  authorEmail: string | null
  createdAt: number
  updatedAt: number
}

export interface UserHistorySession extends HistorySession {
  gameCount: number
  wasOwner: boolean
  firstSeenAt: number
  lastSeenAt: number
}

export interface VoiceStatus {
  voiceChannelId: string | null
  states: { userId: string; channelId: string | null }[]
}

// ── Party history + League games ──────────────────────────────────────────────

export interface HistorySession {
  historyId: number
  guildId: string
  partyId: string
  name: string
  game: string
  ownerId: string
  ownerName: string
  maxSize: number
  createdAt: number
  endedAt?: number
  endReason?: string
}

export interface HistorySummary extends HistorySession {
  eventCount: number
  gameCount: number
  participantCount: number
}

export type HistoryEventKind =
  | 'created' | 'joined' | 'queued' | 'left' | 'dequeued' | 'removed'
  | 'promoted' | 'approved' | 'denied' | 'owner_changed'
  | 'closed' | 'opened' | 'game_changed' | 'banlist_set' | 'disbanded'

export interface HistoryEvent {
  ts: number
  event: HistoryEventKind
  userId?: string
  displayName?: string
  detail?: Record<string, unknown>
}

export interface GameParticipant {
  puuid: string
  riotId: string
  championId: number
  championName: string
  teamId: number
  win: boolean | null
}

export interface PartyGame {
  id: number
  matchId: string
  region: string | null
  gameId: string
  reportedBy: string
  reportedAt: number
  status: 'pending' | 'resolved' | 'failed'
  resolvedAt?: number
  queueId?: number
  gameCreation?: number
  gameDuration?: number
  error?: string
  participants: GameParticipant[]
}

export interface HistoryDetail {
  session: HistorySession
  events: HistoryEvent[]
  games: PartyGame[]
}

export interface PartyGamesResponse {
  historyId: number | null
  games: PartyGame[]
}
