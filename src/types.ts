export interface PartyMember {
  userId: string
  username: string
  displayName: string
  ign?: string
  joinedAt: number
}

export interface QueueEntry {
  userId: string
  username: string
  displayName: string
  ign?: string
  queuedAt: number
}

export interface PartyData {
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
  members: PartyMember[]
  queue: QueueEntry[]
  banlist?: BanList
}

export interface BanList {
  source: string[]                       // original list as the owner pasted it
  pool: string[]                         // unassigned bans, FIFO
  assignments: Record<string, string>    // userId -> assigned ban
}

export interface AppBindings extends Record<string, unknown> {
  PARTY_STATE: DurableObjectNamespace
  PARTY_KV: KVNamespace
  DISCORD_PUBLIC_KEY: string
  DISCORD_BOT_TOKEN: string
  DISCORD_APPLICATION_ID: string
}

export type AppEnv = { Bindings: AppBindings }

export interface PartyIndexEntry {
  id: string
  name: string
  game: string
}

export type JoinResult = {
  status: 'joined' | 'queued' | 'already_member' | 'already_queued'
  data: PartyData
  promoted?: string
}

export type LeaveResult = {
  status: 'left' | 'dequeued' | 'not_in' | 'is_owner'
  data: PartyData
  promoted?: string
}

export type ApproveResult = {
  status: 'approved' | 'not_queued' | 'full' | 'unauthorized'
  data: PartyData
}

export type DenyResult = {
  status: 'denied' | 'not_queued' | 'unauthorized'
  data: PartyData
}

export type RemoveResult = {
  status: 'removed' | 'not_in' | 'unauthorized' | 'is_owner'
  data: PartyData
  promoted?: string
}

export type CloseResult = {
  status: 'closed' | 'already_closed' | 'unauthorized'
  data: PartyData
}

export type OpenResult = {
  status: 'opened' | 'already_open' | 'unauthorized'
  data: PartyData
  promoted: string[]
}

export type SetIgnResult = {
  status: 'updated' | 'not_in'
  data: PartyData
}

export type DisbandResult = {
  status: 'disbanded' | 'unauthorized'
  data: PartyData
}

export type SetGameResult = {
  status: 'updated' | 'unauthorized' | 'same_game'
  data: PartyData
}

export type ForceAddResult = {
  status: 'added' | 'already_member' | 'full' | 'unauthorized'
  data: PartyData
}

export type PromoteResult = {
  status: 'promoted' | 'unauthorized' | 'not_in' | 'already_owner'
  data: PartyData
}

export type SetSizeResult = {
  status: 'updated' | 'unauthorized' | 'too_small' | 'invalid' | 'unchanged'
  data: PartyData
  promoted: string[]
}

export type SetDescriptionResult = {
  status: 'updated' | 'unauthorized'
  data: PartyData
}

export type SetBanlistResult = {
  status: 'updated' | 'unauthorized'
  data: PartyData
}

export type SetNameResult = {
  status: 'updated' | 'unauthorized' | 'invalid'
  data: PartyData
}

export type SetVoiceResult = {
  status: 'updated' | 'unauthorized'
  data: PartyData
}

export interface UserProfile {
  igns: Record<string, string>
}
