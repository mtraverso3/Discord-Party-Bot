import type { AppBindings, PartyData, UpdateResult } from '../types'
import { GAMES } from '../lib/games'
import {
  callParty, findUserIdByRiotId, getPartyStub, getUserProfile, getUserPartyId, updateIndexEntry, trySyncEmbed,
  setUserPartyId,
} from '../lib/party'
import { gameAllowed, getGuildSettings } from '../lib/settings'
import { getGuildMember } from '../lib/discord'
import { fetchLiveGame, getChampionCatalog, platformForRegion } from '../lib/riot'

const VALID_GAMES = new Set<string>(GAMES.map(g => g.value))

// HTTP API consumed by the PartyBot desktop client.
//
//   POST   /client/auth        { code }  -> { token, userId, guildId, displayName }
//   GET    /client/session     (Bearer)  -> { userId, displayName, guildId, canInvite, party | null }
//   DELETE /client/session     (Bearer)  -> { ok }
//   POST   /client/party/game  (Bearer) { game } -> { ok, game? } | { ok: false, error }
//   POST   /client/lookup      (Bearer) { riotIds } -> { players: Record<riotId, { userId, displayName } | null> }
//   POST   /client/party/add   (Bearer) { userId } -> { ok, party? } | { ok: false, error }
//   GET    /client/champions/catalog (Bearer) -> { version, champions: Record<id, { id, name, iconUrl }> }
//   POST   /client/champions/live    (Bearer) { region, puuid } -> { ok, configured, live, participants: [{ puuid, championId, teamId }] }
//
// A short-lived link code (from `/party link` in Discord) is exchanged once
// for a long-lived bearer token tied to the Discord user, so the client stays
// linked across parties and restarts.

export interface LinkRecord {
  guildId: string
  discordUserId: string
  displayName: string
}

interface TokenRecord {
  userId: string
  guildId: string
  displayName: string
  createdAt: number
  refreshedAt: number
}

const LINK_TTL_SECONDS = 10 * 60                  // link codes: 10 minutes
const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60       // tokens: 90 days, sliding
const TOKEN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000  // re-extend at most daily
const CODE_LENGTH = 8
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // omit ambiguous chars

export function generateLinkCode(): string {
  const buf = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(buf)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[buf[i]! % CODE_ALPHABET.length]
  }
  return out
}

export async function writeLinkCode(
  kv: KVNamespace,
  code: string,
  record: LinkRecord,
): Promise<void> {
  await kv.put(`lcu:${code}`, JSON.stringify(record), { expirationTtl: LINK_TTL_SECONDS })
}

function generateToken(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function handleClientApi(req: Request, env: AppBindings, url: URL): Promise<Response> {
  if (url.pathname === '/client/auth' && req.method === 'POST') {
    return await auth(req, env)
  }
  if (url.pathname === '/client/session') {
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    return await session(req, env)
  }
  if (url.pathname === '/client/party/game' && req.method === 'POST') {
    return await setPartyGame(req, env)
  }
  if (url.pathname === '/client/lookup' && req.method === 'POST') {
    return await lookupPlayers(req, env)
  }
  if (url.pathname === '/client/party/add' && req.method === 'POST') {
    return await addPartyMember(req, env)
  }
  if (url.pathname === '/client/champions/catalog' && req.method === 'GET') {
    return await championCatalog(req, env)
  }
  if (url.pathname === '/client/champions/live' && req.method === 'POST') {
    return await liveChampions(req, env)
  }
  return new Response('Not Found', { status: 404 })
}

/**
 * Resolve the bearer token to its stored record (sliding-refreshing its TTL
 * while in active use), or null if missing/invalid/expired.
 */
async function authenticate(req: Request, env: AppBindings): Promise<{ key: string; rec: TokenRecord } | null> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const key = `client-token:${token}`
  const raw = await env.PARTY_KV.get(key)
  if (!raw) return null
  const rec = JSON.parse(raw) as TokenRecord

  const now = Date.now()
  if (now - rec.refreshedAt > TOKEN_REFRESH_INTERVAL_MS) {
    rec.refreshedAt = now
    await env.PARTY_KV.put(key, JSON.stringify(rec), { expirationTtl: TOKEN_TTL_SECONDS })
  }
  return { key, rec }
}

async function auth(req: Request, env: AppBindings): Promise<Response> {
  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  if (!/^[A-Z2-9]{8}$/.test(code)) return json({ error: 'Invalid code format.' }, 400)

  const raw = await env.PARTY_KV.get(`lcu:${code}`)
  if (!raw) return json({ error: 'Code not found or expired. Run /party link again.' }, 404)
  const link = JSON.parse(raw) as LinkRecord

  // Codes are single-use.
  await env.PARTY_KV.delete(`lcu:${code}`)

  const token = generateToken()
  const now = Date.now()
  const rec: TokenRecord = {
    userId: link.discordUserId,
    guildId: link.guildId,
    displayName: link.displayName,
    createdAt: now,
    refreshedAt: now,
  }
  await env.PARTY_KV.put(`client-token:${token}`, JSON.stringify(rec), {
    expirationTtl: TOKEN_TTL_SECONDS,
  })

  return json({
    token,
    userId: link.discordUserId,
    guildId: link.guildId,
    displayName: link.displayName,
  })
}

async function session(req: Request, env: AppBindings): Promise<Response> {
  const auth = await authenticate(req, env)
  if (!auth) return json({ error: 'Not linked.' }, 401)
  const { key, rec } = auth

  if (req.method === 'DELETE') {
    await env.PARTY_KV.delete(key)
    return json({ ok: true })
  }

  const partyId = await getUserPartyId(env.PARTY_KV, rec.guildId, rec.userId)
  let party: unknown = null
  let canInvite = false
  if (partyId) {
    const stub = getPartyStub(env, rec.guildId, partyId)
    const data = await callParty<PartyData | null>(stub, 'get').catch(() => null)
    if (data && data.members.some(m => m.userId === rec.userId)) {
      const settings = await getGuildSettings(env.PARTY_KV, rec.guildId)
      const isOwner = data.ownerId === rec.userId
      canInvite = isOwner || settings.clientInviters.includes(rec.userId)
      party = {
        id: data.id,
        name: data.name,
        game: data.game,
        maxSize: data.maxSize,
        isOwner,
        members: data.members.map(m => ({
          userId: m.userId,
          displayName: m.displayName,
          ign: m.ign ?? null,
          isOwner: m.userId === data.ownerId,
        })),
      }
    }
  }

  return json({
    userId: rec.userId,
    displayName: rec.displayName,
    guildId: rec.guildId,
    canInvite,
    party,
  })
}

// Changes a party's game — used by the desktop client to auto-switch e.g.
// "LoL NA" when it detects the linked player is on a matching League account.
// Only the party owner may do this (same rule as `/party edit`).
async function setPartyGame(req: Request, env: AppBindings): Promise<Response> {
  const auth = await authenticate(req, env)
  if (!auth) return json({ ok: false, error: 'Not linked.' }, 401)
  const { rec } = auth

  let body: { game?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }
  const game = typeof body.game === 'string' ? body.game.trim() : ''
  if (!game) return json({ ok: false, error: 'game is required.' }, 400)
  // Every other way to set a party's game (the /party create/edit dropdown,
  // the admin API) is constrained to the GAMES catalog — this client-facing
  // path is the first one reachable by any linked user, not just admins, so
  // it needs the same guard against an arbitrary, unbounded string landing
  // in the guild-wide party index.
  if (!VALID_GAMES.has(game)) return json({ ok: false, error: 'Invalid game.' }, 400)

  const partyId = await getUserPartyId(env.PARTY_KV, rec.guildId, rec.userId)
  if (!partyId) return json({ ok: false, error: 'You are not in a party.' }, 404)

  const stub = getPartyStub(env, rec.guildId, partyId)
  const current = await callParty<PartyData | null>(stub, 'get').catch(() => null)
  if (!current) return json({ ok: false, error: 'Party not found.' }, 404)
  if (current.ownerId !== rec.userId) {
    return json({ ok: false, error: 'Only the party owner can change the game.' }, 403)
  }
  if (current.game === game) return json({ ok: true, game })

  const settings = await getGuildSettings(env.PARTY_KV, rec.guildId)
  if (!gameAllowed(settings, game)) return json({ ok: false, error: `${game} is not enabled on this server.` }, 400)

  // Refresh every member's/queued user's IGN from their per-game profile, same
  // as the `/party edit` modal does when the game changes.
  const ids = [...current.members.map(m => m.userId), ...current.queue.map(q => q.userId)]
  const profiles = await Promise.all(ids.map(uid => getUserProfile(env.PARTY_KV, uid)))
  const ignMap: Record<string, string> = {}
  ids.forEach((uid, i) => {
    const ign = profiles[i]!.igns[game]
    if (ign) ignMap[uid] = ign
  })

  const result = await callParty<UpdateResult>(stub, 'update', {
    requesterId: rec.userId,
    game,
    ignMap,
  }).catch(() => null)
  if (!result) return json({ ok: false, error: 'Party not found.' }, 404)
  if (result.status === 'unauthorized') return json({ ok: false, error: 'Only the party owner can change the game.' }, 403)
  if (result.status === 'invalid') return json({ ok: false, error: result.message ?? 'Invalid input.' }, 400)

  if (result.gameChanged) {
    await updateIndexEntry(env.PARTY_KV, rec.guildId, partyId, { game: result.data.game })
  }
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)

  return json({ ok: true, game: result.data.game })
}

/** Split a "Name#Tag" Riot ID string; tagline is optional. */
function parseRiotId(raw: string): { name: string; tag: string } | null {
  const s = raw.trim()
  if (!s) return null
  const hash = s.indexOf('#')
  if (hash === -1) return { name: s, tag: '' }
  const name = s.slice(0, hash).trim()
  if (!name) return null
  return { name, tag: s.slice(hash + 1).trim() }
}

export interface LookupHit {
  userId: string
  displayName: string
}

// Reverse-looks-up Riot IDs the client saw in the live League lobby against
// registered player profiles, so it can tell "not in the party" apart from
// "not in the system at all" and offer to add the former straight from the app.
async function lookupPlayers(req: Request, env: AppBindings): Promise<Response> {
  const auth = await authenticate(req, env)
  if (!auth) return json({ error: 'Not linked.' }, 401)
  const { rec } = auth

  let body: { riotIds?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }
  const riotIds = Array.isArray(body.riotIds)
    ? body.riotIds.filter((r): r is string => typeof r === 'string').slice(0, 50)
    : []

  const partyId = await getUserPartyId(env.PARTY_KV, rec.guildId, rec.userId)
  if (!partyId) return json({ error: 'You are not in a party.' }, 404)
  const stub = getPartyStub(env, rec.guildId, partyId)
  const party = await callParty<PartyData | null>(stub, 'get').catch(() => null)
  if (!party) return json({ error: 'Party not found.' }, 404)

  const memberIds = new Set(party.members.map(m => m.userId))
  const players: Record<string, LookupHit | null> = {}

  await Promise.all(riotIds.map(async (riotId) => {
    const parsed = parseRiotId(riotId)
    if (!parsed) { players[riotId] = null; return }
    const userId = await findUserIdByRiotId(env.PARTY_KV, party.game, parsed.name, parsed.tag)
    if (!userId || memberIds.has(userId)) { players[riotId] = null; return }
    const member = await getGuildMember(env.DISCORD_BOT_TOKEN, rec.guildId, userId).catch(() => null)
    if (!member?.user) { players[riotId] = null; return } // left the server, or never joined it
    players[riotId] = { userId, displayName: member.nick ?? member.user.global_name ?? member.user.username }
  }))

  return json({ players })
}

// Adds a recognized (but not-yet-partied) player straight into the caller's
// party — the desktop-client equivalent of the admin panel's "add member",
// gated the same way `forceadd` itself is: owner only.
async function addPartyMember(req: Request, env: AppBindings): Promise<Response> {
  const auth = await authenticate(req, env)
  if (!auth) return json({ ok: false, error: 'Not linked.' }, 401)
  const { rec } = auth

  let body: { userId?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }
  const targetId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!targetId) return json({ ok: false, error: 'userId is required.' }, 400)

  const partyId = await getUserPartyId(env.PARTY_KV, rec.guildId, rec.userId)
  if (!partyId) return json({ ok: false, error: 'You are not in a party.' }, 404)
  const stub = getPartyStub(env, rec.guildId, partyId)
  const party = await callParty<PartyData | null>(stub, 'get').catch(() => null)
  if (!party) return json({ ok: false, error: 'Party not found.' }, 404)
  if (party.ownerId !== rec.userId) return json({ ok: false, error: 'Only the party owner can add members.' }, 403)

  const existingPartyId = await getUserPartyId(env.PARTY_KV, rec.guildId, targetId)
  if (existingPartyId && existingPartyId !== partyId) {
    return json({ ok: false, error: 'That player is already in another party.' }, 400)
  }

  const member = await getGuildMember(env.DISCORD_BOT_TOKEN, rec.guildId, targetId).catch(() => null)
  if (!member?.user) return json({ ok: false, error: 'User not found in this server.' }, 404)

  const profile = await getUserProfile(env.PARTY_KV, targetId)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'forceadd', {
    requesterId: rec.userId,
    userId: targetId,
    username: member.user.username,
    displayName: member.nick ?? member.user.global_name ?? member.user.username,
    ign: profile.igns[party.game],
  })
  if (result.status === 'already_member') return json({ ok: false, error: 'Already a member.' }, 400)
  if (result.status === 'full') return json({ ok: false, error: 'Party is full.' }, 400)
  if (result.status === 'unauthorized') return json({ ok: false, error: 'Only the party owner can add members.' }, 403)

  await setUserPartyId(env.PARTY_KV, rec.guildId, targetId, partyId)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json({ ok: true })
}

// Serves the Data Dragon champion catalog (id -> name + icon URL) so the client
// can render the numeric championIds it reads locally. Public data, but gated
// behind the same bearer auth as everything else here.
async function championCatalog(req: Request, env: AppBindings): Promise<Response> {
  const auth = await authenticate(req, env)
  if (!auth) return json({ error: 'Not linked.' }, 401)
  try {
    const catalog = await getChampionCatalog(env)
    return json(catalog)
  } catch {
    return json({ error: 'Champion catalog is temporarily unavailable.' }, 502)
  }
}

// Looks up the caller-supplied player's live game via the Riot Spectator API and
// returns each participant's champion. Used by the client once a match has
// actually started (the local champ-select session is gone by then). Custom
// games aren't exposed by Spectator, so `live: false` there is expected.
async function liveChampions(req: Request, env: AppBindings): Promise<Response> {
  const auth = await authenticate(req, env)
  if (!auth) return json({ ok: false, error: 'Not linked.' }, 401)

  if (!env.RIOT_API_KEY) {
    // Not an error — the client treats this as "fall back to local data".
    return json({ ok: true, configured: false, live: false, participants: [] })
  }

  let body: { region?: unknown; puuid?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }
  const region = typeof body.region === 'string' ? body.region.trim() : ''
  const puuid = typeof body.puuid === 'string' ? body.puuid.trim() : ''
  if (!region || !puuid) return json({ ok: false, error: 'region and puuid are required.' }, 400)

  const platform = platformForRegion(region)
  if (!platform) return json({ ok: false, error: `Unsupported region "${region}".` }, 400)

  try {
    const game = await fetchLiveGame(env.RIOT_API_KEY, platform, puuid)
    if (!game) return json({ ok: true, configured: true, live: false, participants: [] })
    return json({ ok: true, configured: true, live: true, participants: game.participants })
  } catch {
    return json({ ok: false, configured: true, error: 'Live-game lookup failed.' }, 502)
  }
}
