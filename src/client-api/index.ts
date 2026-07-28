import type { AppBindings } from '../types'
import { GAMES } from '../lib/games'
import * as parties from '../store/parties'
import { findUserIdByRiotId, getIgnMap, getUserIgn } from '../store/profiles'
import { consumeLinkCode, createClientToken, deleteClientToken, resolveClientToken, type TokenRecord } from '../store/clientAuth'
import { activeSessionId } from '../store/history'
import { reportGame } from '../store/games'
import { gameAllowed, getGuildSettings } from '../store/settings'
import { trySyncEmbed } from '../lib/party'
import { getGuildMember, getMemberAvatarUrl } from '../lib/discord'
import { fetchLiveGame, getChampionCatalog, platformForRegion } from '../lib/riot'

export { generateLinkCode, writeLinkCode, type LinkRecord } from '../store/clientAuth'

const VALID_GAMES = new Set<string>(GAMES.map(g => g.value))

// HTTP API consumed by the PartyBot desktop client.
//
//   POST   /client/auth        { code }  -> { token, userId, guildId, displayName }
//   GET    /client/session     (Bearer)  -> { userId, displayName, guildId, canInvite, party | null }
//   DELETE /client/session     (Bearer)  -> { ok }
//   POST   /client/party/game  (Bearer) { game } -> { ok, game? } | { ok: false, error }
//   POST   /client/lookup      (Bearer) { riotIds } -> { players: Record<riotId, { userId, displayName, inParty } | null> }
//   POST   /client/party/add   (Bearer) { userId } -> { ok, party? } | { ok: false, error }
//   POST   /client/party/approve (Bearer) { userId } -> { ok } | { ok: false, error }
//   POST   /client/party/deny    (Bearer) { userId } -> { ok } | { ok: false, error }
//   POST   /client/party/game-report (Bearer) { region, gameId } -> { ok, status, matchId } | { ok: false, error }
//   GET    /client/champions/catalog (Bearer) -> { version, champions: Record<id, { id, name, iconUrl }> }
//   POST   /client/champions/live    (Bearer) { region, gameName, tagLine } -> { ok, configured, live, participants: [{ riotId, championId, teamId }] }
//
// A short-lived link code (from `/party link` in Discord) is exchanged once
// for a long-lived bearer token tied to the Discord user, so the client stays
// linked across parties and restarts.

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
  if (url.pathname === '/client/party/approve' && req.method === 'POST') {
    return await approvePartyQueued(req, env)
  }
  if (url.pathname === '/client/party/deny' && req.method === 'POST') {
    return await denyPartyQueued(req, env)
  }
  if (url.pathname === '/client/party/game-report' && req.method === 'POST') {
    return await reportPartyGame(req, env)
  }
  if (url.pathname === '/client/champions/catalog' && req.method === 'GET') {
    return await championCatalog(req, env)
  }
  if (url.pathname === '/client/champions/live' && req.method === 'POST') {
    return await liveChampions(req, env)
  }
  return new Response('Not Found', { status: 404 })
}

/** Resolve the bearer token to its stored record, or null if missing/invalid/expired. */
async function authenticate(req: Request, env: AppBindings): Promise<{ token: string; rec: TokenRecord } | null> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const rec = await resolveClientToken(env.DB, token)
  return rec ? { token, rec } : null
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

  // Codes are single-use — the read deletes them.
  const link = await consumeLinkCode(env.DB, code)
  if (!link) return json({ error: 'Code not found or expired. Run /party link again.' }, 404)

  const token = await createClientToken(env.DB, link)

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
  const { token, rec } = auth

  if (req.method === 'DELETE') {
    await deleteClientToken(env.DB, token)
    return json({ ok: true })
  }

  const partyId = await parties.getUserPartyId(env.DB, rec.guildId, rec.userId)
  let party: unknown = null
  let canInvite = false
  if (partyId) {
    const data = await parties.getParty(env.DB, rec.guildId, partyId)
    if (data && data.members.some(m => m.userId === rec.userId)) {
      const settings = await getGuildSettings(env.DB, rec.guildId)
      const isOwner = data.ownerId === rec.userId
      canInvite = isOwner || settings.clientInviters.includes(rec.userId)
      // Queued users are already public in the Discord embed, so every member
      // sees them here; only the owner gets an approve button for them.
      const roster = [...data.members, ...data.queue]
      const avatarUrls = await Promise.all(
        roster.map(m => getMemberAvatarUrl(env.DISCORD_BOT_TOKEN, rec.guildId, m.userId).catch(() => null)),
      )
      party = {
        id: data.id,
        name: data.name,
        game: data.game,
        maxSize: data.maxSize,
        isOwner,
        isClosed: data.isClosed,
        members: data.members.map((m, i) => ({
          userId: m.userId,
          displayName: m.displayName,
          ign: m.ign ?? null,
          isOwner: m.userId === data.ownerId,
          assignedBan: data.banlist?.assignments[m.userId] ?? null,
          avatarUrl: avatarUrls[i] ?? null,
        })),
        queue: data.queue.map((q, i) => ({
          userId: q.userId,
          displayName: q.displayName,
          ign: q.ign ?? null,
          avatarUrl: avatarUrls[data.members.length + i] ?? null,
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
  // path is reachable by any linked user, so it needs the same guard against
  // an arbitrary, unbounded string.
  if (!VALID_GAMES.has(game)) return json({ ok: false, error: 'Invalid game.' }, 400)

  const partyId = await parties.getUserPartyId(env.DB, rec.guildId, rec.userId)
  if (!partyId) return json({ ok: false, error: 'You are not in a party.' }, 404)

  const current = await parties.getParty(env.DB, rec.guildId, partyId)
  if (!current) return json({ ok: false, error: 'Party not found.' }, 404)
  if (current.ownerId !== rec.userId) {
    return json({ ok: false, error: 'Only the party owner can change the game.' }, 403)
  }
  if (current.game === game) return json({ ok: true, game })

  const settings = await getGuildSettings(env.DB, rec.guildId)
  if (!gameAllowed(settings, game)) return json({ ok: false, error: `${game} is not enabled on this server.` }, 400)

  // Refresh every member's/queued user's IGN from their per-game profile, same
  // as the `/party edit` modal does when the game changes.
  const ids = [...current.members.map(m => m.userId), ...current.queue.map(q => q.userId)]
  const ignMap = await getIgnMap(env.DB, ids, game)

  const result = await parties.updateParty(env.DB, rec.guildId, partyId, {
    requesterId: rec.userId,
    game,
    ignMap,
  })
  if (result.status === 'not_found') return json({ ok: false, error: 'Party not found.' }, 404)
  if (result.status === 'unauthorized') return json({ ok: false, error: 'Only the party owner can change the game.' }, 403)
  if (result.status === 'invalid') return json({ ok: false, error: result.message ?? 'Invalid input.' }, 400)

  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)

  return json({ ok: true, game: result.data!.game })
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
  /** True when this Riot ID belongs to someone already in the caller's party. */
  inParty: boolean
}

// Reverse-looks-up Riot IDs the client saw in the live League lobby against
// registered player profiles, so it can tell "not in the party" apart from
// "not in the system at all" and offer to add the former straight from the app.
//
// Hits that resolve to a current member are reported too, with `inParty: true`.
// The client asks about a Riot ID precisely because its own IGN snapshot didn't
// match it, so "that's your own member, renamed" is the answer it most needs —
// swallowing it here is what made renamed members show up as intruders.
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

  const partyId = await parties.getUserPartyId(env.DB, rec.guildId, rec.userId)
  if (!partyId) return json({ error: 'You are not in a party.' }, 404)
  const party = await parties.getParty(env.DB, rec.guildId, partyId)
  if (!party) return json({ error: 'Party not found.' }, 404)

  const membersById = new Map(party.members.map(m => [m.userId, m]))
  const players: Record<string, LookupHit | null> = {}

  await Promise.all(riotIds.map(async (riotId) => {
    const parsed = parseRiotId(riotId)
    if (!parsed) { players[riotId] = null; return }
    const userId = await findUserIdByRiotId(env.DB, party.game, parsed.name, parsed.tag)
    if (!userId) { players[riotId] = null; return }
    // Already a member: answer from the roster the client is rendering, so the
    // name it shows lines up with the party list — and skip the Discord fetch.
    const partyMember = membersById.get(userId)
    if (partyMember) {
      players[riotId] = { userId, displayName: partyMember.displayName, inParty: true }
      return
    }
    const member = await getGuildMember(env.DISCORD_BOT_TOKEN, rec.guildId, userId).catch(() => null)
    if (!member?.user) { players[riotId] = null; return } // left the server, or never joined it
    players[riotId] = {
      userId,
      displayName: member.nick ?? member.user.global_name ?? member.user.username,
      inParty: false,
    }
  }))

  return json({ players })
}

// Adds a recognized (but not-yet-partied) player straight into the caller's
// party — the desktop-client equivalent of the admin panel's "add member",
// gated the same way force-adds always are: owner only.
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

  const partyId = await parties.getUserPartyId(env.DB, rec.guildId, rec.userId)
  if (!partyId) return json({ ok: false, error: 'You are not in a party.' }, 404)
  const party = await parties.getParty(env.DB, rec.guildId, partyId)
  if (!party) return json({ ok: false, error: 'Party not found.' }, 404)
  if (party.ownerId !== rec.userId) return json({ ok: false, error: 'Only the party owner can add members.' }, 403)

  const existingPartyId = await parties.getUserPartyId(env.DB, rec.guildId, targetId)
  if (existingPartyId && existingPartyId !== partyId) {
    return json({ ok: false, error: 'That player is already in another party.' }, 400)
  }

  const member = await getGuildMember(env.DISCORD_BOT_TOKEN, rec.guildId, targetId).catch(() => null)
  if (!member?.user) return json({ ok: false, error: 'User not found in this server.' }, 404)

  const ign = await getUserIgn(env.DB, targetId, party.game)
  const result = await parties.forceAdd(env.DB, rec.guildId, partyId, rec.userId, {
    userId: targetId,
    username: member.user.username,
    displayName: member.nick ?? member.user.global_name ?? member.user.username,
    ign,
  })
  if (result.status === 'not_found') return json({ ok: false, error: 'Party not found.' }, 404)
  if (result.status === 'already_member') return json({ ok: false, error: 'Already a member.' }, 400)
  if (result.status === 'in_other_party') return json({ ok: false, error: 'That player is already in another party.' }, 400)
  if (result.status === 'full') return json({ ok: false, error: 'Party is full.' }, 400)
  if (result.status === 'unauthorized') return json({ ok: false, error: 'Only the party owner can add members.' }, 403)

  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json({ ok: true })
}

// Shared preamble for the queue actions below: authenticate, read the target
// user out of the body, and resolve the caller's party. Returns a ready-made
// error Response, or the ids the action needs.
async function queueActionContext(
  req: Request, env: AppBindings,
): Promise<Response | { guildId: string; partyId: string; requesterId: string; targetId: string }> {
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

  const partyId = await parties.getUserPartyId(env.DB, rec.guildId, rec.userId)
  if (!partyId) return json({ ok: false, error: 'You are not in a party.' }, 404)

  return { guildId: rec.guildId, partyId, requesterId: rec.userId, targetId }
}

// Lets a party owner approve a queued player from the desktop client — the
// same thing `/party approve` does in Discord. A closed party sends every
// joiner to the queue, so without this the owner has to go back to Discord to
// let anyone in while they're mid-lobby.
async function approvePartyQueued(req: Request, env: AppBindings): Promise<Response> {
  const ctx = await queueActionContext(req, env)
  if (ctx instanceof Response) return ctx
  const { guildId, partyId, requesterId, targetId } = ctx

  const result = await parties.approveQueued(env.DB, guildId, partyId, requesterId, targetId)
  if (result.status === 'not_found')    return json({ ok: false, error: 'Party not found.' }, 404)
  if (result.status === 'unauthorized') return json({ ok: false, error: 'Only the party owner can approve members.' }, 403)
  if (result.status === 'not_queued')   return json({ ok: false, error: 'That player is no longer in the queue.' }, 400)
  if (result.status === 'full')         return json({ ok: false, error: 'Party is full.' }, 400)

  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json({ ok: true })
}

// The counterpart to approve — drops a queued player, same as `/party deny`.
async function denyPartyQueued(req: Request, env: AppBindings): Promise<Response> {
  const ctx = await queueActionContext(req, env)
  if (ctx instanceof Response) return ctx
  const { guildId, partyId, requesterId, targetId } = ctx

  const result = await parties.denyQueued(env.DB, guildId, partyId, requesterId, targetId)
  if (result.status === 'not_found')    return json({ ok: false, error: 'Party not found.' }, 404)
  if (result.status === 'unauthorized') return json({ ok: false, error: 'Only the party owner can deny members.' }, 403)
  if (result.status === 'not_queued')   return json({ ok: false, error: 'That player is no longer in the queue.' }, 400)

  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json({ ok: true })
}

// Records a League match the client detected starting for the caller's party.
// The match isn't queryable from Riot until the game ends, so this just files
// the gameId against the party's active history session; a cron sweep later
// resolves it to participants + champions via Match-v5.
async function reportPartyGame(req: Request, env: AppBindings): Promise<Response> {
  const auth = await authenticate(req, env)
  if (!auth) return json({ ok: false, error: 'Not linked.' }, 401)
  const { rec } = auth

  let body: { region?: unknown; gameId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }
  const region = typeof body.region === 'string' ? body.region.trim() : ''
  const gameId = body.gameId != null ? String(body.gameId).trim() : ''
  if (!region || !gameId) return json({ ok: false, error: 'region and gameId are required.' }, 400)
  if (!platformForRegion(region)) return json({ ok: false, error: `Unsupported region "${region}".` }, 400)

  const partyId = await parties.getUserPartyId(env.DB, rec.guildId, rec.userId)
  if (!partyId) return json({ ok: false, error: 'You are not in a party.' }, 404)
  const historyId = await activeSessionId(env.DB, rec.guildId, partyId)
  if (historyId == null) return json({ ok: false, error: 'No active party session.' }, 404)

  const result = await reportGame(env.DB, {
    historyId, guildId: rec.guildId, partyId, region, gameId, reportedBy: rec.userId,
  })
  if (!result.ok) return json({ ok: false, error: result.error }, 400)
  return json({ ok: true, status: result.status, matchId: result.matchId })
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

  let body: { region?: unknown; gameName?: unknown; tagLine?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400)
  }
  const region = typeof body.region === 'string' ? body.region.trim() : ''
  const gameName = typeof body.gameName === 'string' ? body.gameName.trim() : ''
  const tagLine = typeof body.tagLine === 'string' ? body.tagLine.trim() : ''
  if (!region || !gameName || !tagLine) {
    return json({ ok: false, error: 'region, gameName and tagLine are required.' }, 400)
  }

  if (!platformForRegion(region)) return json({ ok: false, error: `Unsupported region "${region}".` }, 400)

  try {
    const game = await fetchLiveGame(env.RIOT_API_KEY, region, gameName, tagLine)
    if (!game) return json({ ok: true, configured: true, live: false, participants: [] })
    return json({ ok: true, configured: true, live: true, participants: game.participants })
  } catch (e) {
    console.error('spectator lookup failed', { region, error: (e as Error).message })
    return json({ ok: false, configured: true, error: (e as Error).message }, 502)
  }
}
