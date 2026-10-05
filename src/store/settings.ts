import type { GuildSettings } from '../types'
import { guildGames, sanitizeCustomGames } from '../lib/games'

export { enabledGames, gameAllowed, guildGames, isKnownGame } from '../lib/games'

export const SETTINGS_DEFAULTS: GuildSettings = {
  maxParties: 10,
  defaultCap: 10,
  customGames: [],     // added on top of the built-in catalog
  disabledGames: [],   // empty = every known game enabled
  clientInviters: [],  // party owners can always invite; these users can too
  partyBumpers: [],    // party owners can always bump; these users can too
}

const DISCORD_ID_RE = /^\d{5,25}$/
const MAX_CLIENT_INVITERS = 50
const MAX_PARTY_BUMPERS = 50

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
  const customGames = sanitizeCustomGames(raw?.customGames)
  const known = new Set(guildGames({ customGames, disabledGames: [] }))
  return {
    maxParties: clampInt(raw?.maxParties, 1, 50, SETTINGS_DEFAULTS.maxParties),
    defaultCap: clampInt(raw?.defaultCap, 2, 50, SETTINGS_DEFAULTS.defaultCap),
    customGames,
    disabledGames: Array.isArray(raw?.disabledGames)
      ? [...new Set<string>(raw.disabledGames.filter((g: unknown): g is string => typeof g === 'string' && known.has(g)))]
      : [],
    clientInviters: idList(raw?.clientInviters, MAX_CLIENT_INVITERS),
    partyBumpers: idList(raw?.partyBumpers, MAX_PARTY_BUMPERS),
  }
}

/** Whether a user may bump the given party: the owner, or a designated bumper. */
export function canBump(settings: GuildSettings, party: { ownerId: string }, userId: string): boolean {
  return party.ownerId === userId || settings.partyBumpers.includes(userId)
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
    .first<{ max_parties: number; default_cap: number; custom_games: string; disabled_games: string; client_inviters: string; party_bumpers: string }>()
  if (!row) return { ...SETTINGS_DEFAULTS }
  return sanitizeSettings({
    maxParties: row.max_parties,
    defaultCap: row.default_cap,
    customGames: parseList(row.custom_games),
    disabledGames: parseList(row.disabled_games),
    clientInviters: parseList(row.client_inviters),
    partyBumpers: parseList(row.party_bumpers),
  })
}

export async function saveGuildSettings(db: D1Database, guildId: string, settings: GuildSettings): Promise<void> {
  await db.prepare(`
    INSERT INTO guild_settings (guild_id, max_parties, default_cap, custom_games, disabled_games, client_inviters, party_bumpers)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT (guild_id) DO UPDATE SET
      max_parties = ?2, default_cap = ?3, custom_games = ?4, disabled_games = ?5, client_inviters = ?6, party_bumpers = ?7
  `).bind(
    guildId, settings.maxParties, settings.defaultCap,
    JSON.stringify(settings.customGames),
    JSON.stringify(settings.disabledGames),
    JSON.stringify(settings.clientInviters),
    JSON.stringify(settings.partyBumpers),
  ).run()
}
