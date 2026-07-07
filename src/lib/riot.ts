// Riot / Data Dragon helpers for surfacing League champion picks to the client.
//
// Two independent concerns live here:
//   1. A champion catalog (id -> name + square-icon URL) sourced from Data
//      Dragon. This is public, needs no API key, and is cached so the client
//      can turn the numeric championIds it reads from the League client into
//      names and icons.
//   2. A live-game lookup via the Riot Spectator-v5 API, which needs
//      RIOT_API_KEY. Given a player's puuid it returns every participant's
//      champion — this is how op.gg knows what everyone locked in. It only
//      covers matchmade games; custom games are not exposed by Spectator (the
//      client falls back to the local champ-select session for those).

import type { AppBindings } from '../types'

// ── Champion catalog (Data Dragon) ───────────────────────────────────────────

export interface ChampionInfo {
  id: number       // numeric championId (matches LCU + Spectator)
  name: string     // display name, e.g. "Miss Fortune"
  iconUrl: string  // square portrait, servable directly in an <img>
}

export interface ChampionCatalog {
  version: string
  champions: Record<string, ChampionInfo>  // keyed by stringified numeric id
}

const CATALOG_KV_KEY = 'riot:champion-catalog'
const CATALOG_TTL_SECONDS = 24 * 60 * 60   // refresh the catalog daily

// Warm in-memory cache so repeated requests in the same isolate skip KV.
let memoryCatalog: { at: number; value: ChampionCatalog } | null = null
const MEMORY_TTL_MS = 60 * 60 * 1000

async function fetchLatestVersion(): Promise<string> {
  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
  if (!res.ok) throw new Error(`ddragon versions ${res.status}`)
  const versions = (await res.json()) as string[]
  const v = versions[0]
  if (!v) throw new Error('ddragon versions empty')
  return v
}

async function buildCatalog(): Promise<ChampionCatalog> {
  const version = await fetchLatestVersion()
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)
  if (!res.ok) throw new Error(`ddragon champions ${res.status}`)
  const data = (await res.json()) as {
    data: Record<string, { key: string; name: string; id: string }>
  }
  const champions: Record<string, ChampionInfo> = {}
  for (const champ of Object.values(data.data)) {
    const numericId = Number(champ.key)
    if (!Number.isFinite(numericId)) continue
    champions[champ.key] = {
      id: numericId,
      name: champ.name,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.id}.png`,
    }
  }
  return { version, champions }
}

/** The champion catalog, served from memory → KV → Data Dragon, in that order. */
export async function getChampionCatalog(env: AppBindings): Promise<ChampionCatalog> {
  const now = Date.now()
  if (memoryCatalog && now - memoryCatalog.at < MEMORY_TTL_MS) return memoryCatalog.value

  const cached = await env.PARTY_KV.get(CATALOG_KV_KEY)
  if (cached) {
    const value = JSON.parse(cached) as ChampionCatalog
    memoryCatalog = { at: now, value }
    return value
  }

  const value = await buildCatalog()
  memoryCatalog = { at: now, value }
  await env.PARTY_KV.put(CATALOG_KV_KEY, JSON.stringify(value), { expirationTtl: CATALOG_TTL_SECONDS })
  return value
}

// ── Live-game lookup (Spectator-v5) ──────────────────────────────────────────

export interface LiveParticipant {
  puuid: string
  championId: number
  teamId: number
}

export interface LiveGame {
  gameId: number
  participants: LiveParticipant[]
}

// Short region codes as reported by the Riot Client's /riotclient/region-locale
// mapped to the platform routing value Spectator-v5 expects in the host.
const REGION_PLATFORM: Record<string, string> = {
  NA: 'na1', EUW: 'euw1', EUNE: 'eun1', KR: 'kr', BR: 'br1',
  LAN: 'la1', LAS: 'la2', OCE: 'oc1', TR: 'tr1', RU: 'ru',
  JP: 'jp1', PBE: 'pbe1', PH: 'ph2', SG: 'sg2', TH: 'th2',
  TW: 'tw2', VN: 'vn2',
}

export function platformForRegion(region: string): string | null {
  return REGION_PLATFORM[region.toUpperCase()] ?? null
}

/**
 * The active game for a player, or null when they aren't in one (or the game is
 * a type Spectator doesn't expose, e.g. customs). Throws only on unexpected
 * upstream failures so the caller can distinguish "not in a game" (null) from
 * "lookup broke".
 */
export async function fetchLiveGame(
  token: string,
  platform: string,
  puuid: string,
): Promise<LiveGame | null> {
  const res = await fetch(
    `https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`,
    { headers: { 'X-Riot-Token': token } },
  )
  if (res.status === 404) return null      // not currently in a (spectatable) game
  if (!res.ok) throw new Error(`spectator ${res.status}`)
  const body = (await res.json()) as {
    gameId: number
    participants: { puuid?: string; championId: number; teamId: number }[]
  }
  return {
    gameId: body.gameId,
    participants: (body.participants ?? [])
      .filter(p => typeof p.puuid === 'string' && p.puuid)
      .map(p => ({ puuid: p.puuid as string, championId: p.championId, teamId: p.teamId })),
  }
}
