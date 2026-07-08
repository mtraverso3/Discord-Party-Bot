// PartyBot Worker API client + persisted link config.

import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { KnownPlayer, TaggedPlayer } from '../shared/types'

const DEFAULT_BOT_URL = 'https://partybot.mtraverso.net'

interface StoredConfig {
  token?: string
  userId?: string
  displayName?: string
  guildId?: string
  botUrl?: string
  autoJoinEnabled?: boolean
  autoJoinTarget?: string   // friend's summoner/Riot ID name to auto-join when their lobby is joinable
  autoJoinInviteParty?: boolean  // after joining, invite the linked Discord party in too
  taggedPlayers?: TaggedPlayer[]  // lobby-only players excluded from the intruder count, with a custom label
}

export interface AutoJoinSettings {
  enabled: boolean
  targetName: string
  inviteParty: boolean
}

let config: StoredConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function loadConfig(): StoredConfig {
  if (config) return config
  try {
    config = JSON.parse(readFileSync(configPath(), 'utf8')) as StoredConfig
  } catch {
    config = {}
  }
  return config
}

function saveConfig(next: StoredConfig): void {
  config = next
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(next, null, 2))
}

export function botUrl(): string {
  return process.env.PARTYBOT_URL || loadConfig().botUrl || DEFAULT_BOT_URL
}

export function linkState(): { linked: boolean; displayName?: string; userId?: string; botUrl: string } {
  const c = loadConfig()
  return c.token
    ? { linked: true, displayName: c.displayName, userId: c.userId, botUrl: botUrl() }
    : { linked: false, botUrl: botUrl() }
}

async function botFetch(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  // Identifies the desktop client to Cloudflare so it isn't mistaken for a
  // headless bot by edge heuristics (e.g. Bot Fight Mode) — those block
  // before the request reaches this Worker's own code, surfacing as a 403
  // with no application-level error body.
  const headers: Record<string, string> = { 'User-Agent': `PartyBot-Client/${app.getVersion()}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${botUrl()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let parsed: any = null
  try { parsed = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body: parsed }
}

export async function linkWithCode(code: string): Promise<{ ok: boolean; error?: string; displayName?: string }> {
  let res: { status: number; body: any }
  try {
    res = await botFetch('POST', '/client/auth', { code })
  } catch (e) {
    return { ok: false, error: `Could not reach PartyBot: ${(e as Error).message}` }
  }
  if (res.status !== 200 || !res.body?.token) {
    return { ok: false, error: res.body?.error ?? `PartyBot returned ${res.status}.` }
  }
  saveConfig({
    ...loadConfig(),
    token: res.body.token,
    userId: res.body.userId,
    displayName: res.body.displayName,
    guildId: res.body.guildId,
  })
  return { ok: true, displayName: res.body.displayName }
}

export async function fetchSession(): Promise<{ ok: boolean; authExpired?: boolean; error?: string; session?: any }> {
  const token = loadConfig().token
  if (!token) return { ok: false, authExpired: true, error: 'Not linked.' }
  let res: { status: number; body: any }
  try {
    res = await botFetch('GET', '/client/session', undefined, token)
  } catch (e) {
    return { ok: false, error: `Could not reach PartyBot: ${(e as Error).message}` }
  }
  if (res.status === 401) {
    clearLink(false)
    return { ok: false, authExpired: true, error: res.body?.error ?? 'Link expired.' }
  }
  if (res.status !== 200) return { ok: false, error: res.body?.error ?? `PartyBot returned ${res.status}.` }
  return { ok: true, session: res.body }
}

export async function setPartyGame(game: string): Promise<{ ok: boolean; error?: string }> {
  const token = loadConfig().token
  if (!token) return { ok: false, error: 'Not linked.' }
  try {
    const res = await botFetch('POST', '/client/party/game', { game }, token)
    if (res.status !== 200) return { ok: false, error: res.body?.error ?? `PartyBot returned ${res.status}.` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Could not reach PartyBot: ${(e as Error).message}` }
  }
}

export async function lookupPlayers(riotIds: string[]): Promise<Record<string, KnownPlayer | null>> {
  const token = loadConfig().token
  if (!token || riotIds.length === 0) return {}
  try {
    const res = await botFetch('POST', '/client/lookup', { riotIds }, token)
    if (res.status !== 200) return {}
    return res.body?.players ?? {}
  } catch {
    return {}
  }
}

export interface ChampionCatalogEntry { id: number; name: string; iconUrl: string }
export interface ChampionCatalog { version: string; champions: Record<string, ChampionCatalogEntry> }

export async function fetchChampionCatalog(): Promise<ChampionCatalog | null> {
  const token = loadConfig().token
  if (!token) return null
  try {
    const res = await botFetch('GET', '/client/champions/catalog', undefined, token)
    if (res.status !== 200 || !res.body?.champions) return null
    return res.body as ChampionCatalog
  } catch {
    return null
  }
}

export interface LiveParticipant { riotId: string; championId: number; teamId: number }

// The Worker resolves the public puuid from the Riot ID (the LCU's own puuid is
// obfuscated and can't be used with the public Riot API), so we pass the
// leader's Riot ID rather than a puuid.
export async function fetchLiveChampions(
  region: string,
  gameName: string,
  tagLine: string,
): Promise<{ live: boolean; participants: LiveParticipant[] }> {
  const token = loadConfig().token
  if (!token || !gameName || !tagLine) return { live: false, participants: [] }
  try {
    const res = await botFetch('POST', '/client/champions/live', { region, gameName, tagLine }, token)
    if (res.status !== 200 || !res.body?.ok) return { live: false, participants: [] }
    return { live: !!res.body.live, participants: res.body.participants ?? [] }
  } catch {
    return { live: false, participants: [] }
  }
}

export async function addToParty(userId: string): Promise<{ ok: boolean; error?: string }> {
  const token = loadConfig().token
  if (!token) return { ok: false, error: 'Not linked.' }
  try {
    const res = await botFetch('POST', '/client/party/add', { userId }, token)
    if (res.status !== 200) return { ok: false, error: res.body?.error ?? `PartyBot returned ${res.status}.` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Could not reach PartyBot: ${(e as Error).message}` }
  }
}

export function getAutoJoinSettings(): AutoJoinSettings {
  const c = loadConfig()
  return { enabled: !!c.autoJoinEnabled, targetName: c.autoJoinTarget ?? '', inviteParty: !!c.autoJoinInviteParty }
}

export function setAutoJoinSettings(next: AutoJoinSettings): void {
  saveConfig({
    ...loadConfig(),
    autoJoinEnabled: next.enabled,
    autoJoinTarget: next.targetName,
    autoJoinInviteParty: next.inviteParty,
  })
}

export function getTaggedPlayers(): TaggedPlayer[] {
  return loadConfig().taggedPlayers ?? []
}

export function setTaggedPlayers(next: TaggedPlayer[]): void {
  saveConfig({ ...loadConfig(), taggedPlayers: next })
}

export function clearLink(revokeRemote = true): void {
  const token = loadConfig().token
  if (revokeRemote && token) {
    botFetch('DELETE', '/client/session', undefined, token).catch(() => { /* best effort */ })
  }
  const { botUrl: storedUrl } = loadConfig()
  try { rmSync(configPath(), { force: true }) } catch { /* ignore */ }
  config = storedUrl ? { botUrl: storedUrl } : {}
  if (storedUrl) saveConfig(config)
}
