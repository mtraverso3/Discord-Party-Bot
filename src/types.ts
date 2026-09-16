export interface PartyMember {
  userId: string
  username: string
  displayName: string
  ign?: string
  away?: boolean  // "brb" marker, toggled by the member from the embed
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
  rulesRequired: boolean    // this party enforces the server’s rules check
  embedMessageId?: string
  embedChannelId?: string
  createdAt: number
  lastActivityAt?: number
  members: PartyMember[]
  queue: QueueEntry[]
  banlist?: BanList
}

export interface BanList {
  source: string[]                       // original list as the owner pasted it
  pool: string[]                         // unassigned bans, FIFO
  assignments: Record<string, string>    // userId -> assigned ban
}

export interface UserRef {
  userId: string
  username: string
  displayName: string
  ign?: string
}

// ── Rules check (ported from the standalone Python bot) ─────────────────────

export interface RulesPage { title: string; text: string }

export interface RulesQuestion {
  text: string
  correct: string[]      // 1-4; a member passes by picking any one of these
  incorrect: string[]    // 0-4
  explanation: string    // shown after any answer, right or wrong
}

export interface RulesConfig {
  version: number
  pages: RulesPage[]
  questions: RulesQuestion[]
  agreement: string
  /** Percentage of the quiz that must be right to pass. 100 by default. */
  passingScore: number
}

export type ApprovalState = 'unapproved' | 'approved'

export interface RulesMemberRow {
  guild_id: string
  user_id: string
  state: ApprovalState
  generation: number
  revocations: number
  completions: number
  version: number | null
  accepted_at: number | null
}

export interface RulesEvent {
  id: number
  userId: string
  kind: string
  actor?: string
  reason: string
  createdAt: number
}

export interface RulesGate {
  enabled: boolean
  /** What a newly created party gets when nobody says either way. */
  defaultRequired: boolean
  channelId?: string   // where the Start button was posted
}

/** A quiz in progress, kept in D1 because a Worker has no memory between requests. */
export interface RulesSession {
  page: number
  question: number
  step: number
  generation: number
  version: number
  /** The answers as shown, already shuffled, so grading matches the buttons. */
  answers: Array<{ text: string; correct: boolean }>
  /** How many questions have been answered correctly so far. */
  correct: number
  feedback: string
  updatedAt: number
}

export interface AppBindings extends Record<string, unknown> {
  DB: D1Database
  // Legacy KV — only used by POST /admin/api/import-kv to migrate old data
  // into D1. Optional so the binding can be removed after the import.
  PARTY_KV?: KVNamespace
  DISCORD_PUBLIC_KEY: string
  DISCORD_BOT_TOKEN: string
  DISCORD_APPLICATION_ID: string
  // Local development only: signs the /admin UI in as this address instead of
  // verifying a Cloudflare Access JWT, and only for requests to localhost.
  // Set it in .dev.vars — never as a deployed secret.
  ADMIN_DEV_EMAIL?: string
  // Optional — only required for the /admin/* UI. When unset, /admin returns 503.
  CF_ACCESS_TEAM?: string   // e.g. "mtraverso" (subdomain of cloudflareaccess.com)
  CF_ACCESS_AUD?: string    // Application AUD tag from the Access app
  // Optional — enables the Discord-identity admin login (magic link → built-in
  // OIDC provider → Cloudflare Access). All required together; when any is
  // unset, /auth and /oidc return 503 and `/party admin` reports it disabled.
  // See docs/admin-ui.md, "Discord admin login".
  PUBLIC_BASE_URL?: string      // public origin serving this Worker, e.g. https://partybot.example.com (no trailing slash)
  ADMIN_SESSION_SECRET?: string // HMAC secret for the 24h admin session cookie
  OIDC_CLIENT_ID?: string       // client_id configured in the Cloudflare Access OIDC login method
  OIDC_CLIENT_SECRET?: string   // matching client_secret
  OIDC_PRIVATE_JWK?: string     // RSA private key (JWK JSON) used to sign OIDC tokens — see scripts/gen-oidc-key.ts
  OIDC_EMAIL_DOMAIN?: string    // synthetic email domain for Discord identities (default "discord.local")
  OIDC_REDIRECT_URI?: string    // optional override of the allowed Access callback URL (derived from CF_ACCESS_TEAM otherwise)
  // Optional — only required for live-game champion lookups (the desktop
  // client's Spectator-based fallback). When unset, that endpoint reports the
  // feature as unavailable and the client relies on the local champ-select read.
  RIOT_API_KEY?: string
  // Static assets binding serving the built admin SPA (admin-ui/dist).
  ASSETS?: Fetcher
}

export type AppEnv = { Bindings: AppBindings }

export type JoinResult = {
  status: 'joined' | 'queued' | 'already_member' | 'already_queued' | 'in_other_party' | 'not_found'
  data?: PartyData
}

export type LeaveResult = {
  status: 'left' | 'dequeued' | 'not_in' | 'is_owner' | 'not_found'
  data?: PartyData
  promoted?: string
}

export type ApproveResult = {
  status: 'approved' | 'not_queued' | 'full' | 'unauthorized' | 'not_found'
  data?: PartyData
}

export type DenyResult = {
  status: 'denied' | 'not_queued' | 'unauthorized' | 'not_found'
  data?: PartyData
}

export type RemoveResult = {
  status: 'removed' | 'not_in' | 'unauthorized' | 'is_owner' | 'not_found'
  data?: PartyData
  promoted?: string
}

export type CloseResult = {
  status: 'closed' | 'already_closed' | 'unauthorized' | 'not_found'
  data?: PartyData
}

export type OpenResult = {
  status: 'opened' | 'already_open' | 'unauthorized' | 'not_found'
  data?: PartyData
  promoted: string[]
}

export type SetIgnResult = {
  status: 'updated' | 'not_in' | 'not_found'
  data?: PartyData
}

export type ToggleAwayResult = {
  status: 'toggled' | 'not_in' | 'not_found'
  data?: PartyData
  away: boolean
}

export type DisbandResult = {
  status: 'disbanded' | 'unauthorized' | 'not_found'
  data?: PartyData
}

export type ForceAddResult = {
  status: 'added' | 'already_member' | 'full' | 'unauthorized' | 'in_other_party' | 'not_found'
  data?: PartyData
}

export type PromoteResult = {
  status: 'promoted' | 'unauthorized' | 'not_in' | 'already_owner' | 'not_found'
  data?: PartyData
}

export type MoveQueueResult = {
  status: 'moved' | 'noop' | 'not_queued' | 'unauthorized' | 'not_found'
  data?: PartyData
}

export type SetBanlistResult = {
  status: 'updated' | 'unauthorized' | 'not_found'
  data?: PartyData
}

export type UpdateResult = {
  status: 'updated' | 'unauthorized' | 'invalid' | 'not_found'
  data?: PartyData
  promoted: string[]
  nameChanged: boolean
  gameChanged: boolean
  message?: string
}

export interface UserProfile {
  igns: Record<string, string>
}

/**
 * A reusable party blueprint. Admins build these once and spin up parties from
 * them, so a recurring party's title/description/cap/game/banlist don't have to
 * be re-entered every time.
 */
export interface PartyTemplate {
  id: string                // short random ID, unique within the guild
  label: string             // how the template shows up in the list
  name: string              // party title produced when applied (may be blank)
  description: string
  game: string
  maxSize: number
  voiceChannelId?: string
  banlist?: string          // newline-separated champion list, as pasted
  rulesRequired: boolean    // parties made from this template require the check
  createdAt: number
  updatedAt: number
}

export interface GuildSettings {
  maxParties: number        // max concurrent parties per guild
  defaultCap: number        // pre-filled player cap when creating a party
  allowedGames: string[]    // subset of GAMES values; empty = all allowed
  clientInviters: string[]  // Discord user IDs allowed to lobby-invite from the desktop client (besides the party owner)
  partyBumpers: string[]    // Discord user IDs allowed to bump any party they're in, even when not the owner
}
