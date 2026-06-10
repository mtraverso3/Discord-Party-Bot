import type { GuildSettings } from '../types'
import { GAMES } from './games'

export const SETTINGS_DEFAULTS: GuildSettings = {
  maxParties: 10,
  defaultCap: 10,
  allowedGames: [],  // empty = all games allowed
}

const VALID_GAMES = new Set<string>(GAMES.map(g => g.value))

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/** Coerce arbitrary stored/submitted data into a valid settings object. */
export function sanitizeSettings(raw: any): GuildSettings {
  return {
    maxParties: clampInt(raw?.maxParties, 1, 50, SETTINGS_DEFAULTS.maxParties),
    defaultCap: clampInt(raw?.defaultCap, 2, 50, SETTINGS_DEFAULTS.defaultCap),
    allowedGames: Array.isArray(raw?.allowedGames)
      ? raw.allowedGames.filter((g: unknown): g is string => typeof g === 'string' && VALID_GAMES.has(g))
      : [],
  }
}

export async function getGuildSettings(kv: KVNamespace, guildId: string): Promise<GuildSettings> {
  const raw = await kv.get(`guild:${guildId}:settings`)
  if (!raw) return { ...SETTINGS_DEFAULTS }
  try {
    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return { ...SETTINGS_DEFAULTS }
  }
}

export async function saveGuildSettings(kv: KVNamespace, guildId: string, settings: GuildSettings): Promise<void> {
  await kv.put(`guild:${guildId}:settings`, JSON.stringify(settings))
}

export function gameAllowed(settings: GuildSettings, game: string): boolean {
  return settings.allowedGames.length === 0 || settings.allowedGames.includes(game)
}
