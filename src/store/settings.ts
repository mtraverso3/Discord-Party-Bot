import type { GuildSettings } from '../types'
import { GAMES } from '../lib/games'

export const SETTINGS_DEFAULTS: GuildSettings = {
  maxParties: 10,
  defaultCap: 10,
  allowedGames: [],    // empty = all games allowed
  clientInviters: [],  // party owners can always invite; these users can too
  partyBumpers: [],    // party owners can always bump; these users can too
}

const DISCORD_ID_RE = /^\d{5,25}$/
const MAX_CLIENT_INVITERS = 50
const MAX_PARTY_BUMPERS = 50

const VALID_GAMES = new Set<string>(GAMES.map(g => g.value))

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

function idList(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? [...new Set<string>(v.filter(
        (id: unknown): id is string => typeof id === 'string' && DISCORD_ID_RE.test(id),
      ))].slice(0, max)
    : []
}

/** Coerce arbitrary stored/submitted data into a valid settings object. */
export function sanitizeSettings(raw: any): GuildSettings {
  return {
    maxParties: clampInt(raw?.maxParties, 1, 50, SETTINGS_DEFAULTS.maxParties),
    defaultCap: clampInt(raw?.defaultCap, 2, 50, SETTINGS_DEFAULTS.defaultCap),
    allowedGames: Array.isArray(raw?.allowedGames)
      ? raw.allowedGames.filter((g: unknown): g is string => typeof g === 'string' && VALID_GAMES.has(g))
      : [],
    clientInviters: idList(raw?.clientInviters, MAX_CLIENT_INVITERS),
    partyBumpers: idList(raw?.partyBumpers, MAX_PARTY_BUMPERS),
  }
}

/** Whether a user may bump the given party: the owner, or a designated bumper. */
export function canBump(settings: GuildSettings, party: { ownerId: string }, userId: string): boolean {
  return party.ownerId === userId || settings.partyBumpers.includes(userId)
}

export function gameAllowed(settings: GuildSettings, game: string): boolean {
  return settings.allowedGames.length === 0 || settings.allowedGames.includes(game)
}

function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export async function getGuildSettings(db: D1Database, guildId: string): Promise<GuildSettings> {
  const row = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?1').bind(guildId)
    .first<{ max_parties: number; default_cap: number; allowed_games: string; client_inviters: string; party_bumpers: string }>()
  if (!row) return { ...SETTINGS_DEFAULTS }
  return sanitizeSettings({
    maxParties: row.max_parties,
    defaultCap: row.default_cap,
    allowedGames: parseList(row.allowed_games),
    clientInviters: parseList(row.client_inviters),
    partyBumpers: parseList(row.party_bumpers),
  })
}

export async function saveGuildSettings(db: D1Database, guildId: string, settings: GuildSettings): Promise<void> {
  await db.prepare(`
    INSERT INTO guild_settings (guild_id, max_parties, default_cap, allowed_games, client_inviters, party_bumpers)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT (guild_id) DO UPDATE SET
      max_parties = ?2, default_cap = ?3, allowed_games = ?4, client_inviters = ?5, party_bumpers = ?6
  `).bind(
    guildId, settings.maxParties, settings.defaultCap,
    JSON.stringify(settings.allowedGames),
    JSON.stringify(settings.clientInviters),
    JSON.stringify(settings.partyBumpers),
  ).run()
}
