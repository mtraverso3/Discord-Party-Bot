// PartyBot Worker API client + persisted link config.

import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_BOT_URL = 'https://partybot.mtraverso.net'

interface StoredConfig {
  token?: string
  userId?: string
  displayName?: string
  guildId?: string
  botUrl?: string
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
  const headers: Record<string, string> = {}
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
