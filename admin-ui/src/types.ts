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

export interface VoiceStatus {
  voiceChannelId: string | null
  states: { userId: string; channelId: string | null }[]
}
