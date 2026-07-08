import type { AppBindings, PartyData } from '../types'
import { createPartyAndEmbed, repostPartyEmbed, tryMarkDisbanded, trySyncEmbed } from '../lib/party'
import * as parties from '../store/parties'
import { getIgnMap, getUserIgn, getUserProfile, saveUserIgn } from '../store/profiles'
import { GAMES } from '../lib/games'
import { gameAllowed, getGuildSettings, sanitizeSettings, saveGuildSettings } from '../store/settings'
import { createTemplate, deleteTemplate, getTemplate, getTemplates, updateTemplate } from '../store/templates'
import { appendAudit, getAudit } from '../store/audit'
import * as history from '../store/history'
import * as games from '../store/games'
import { getBotGuilds, getGuildChannels, getGuildMember, getMemberAvatarUrl, getUserById, getUserVoiceChannel, searchGuildMembers } from '../lib/discord'
import { importFromKv } from './import'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function handleAdminApi(req: Request, env: AppBindings, url: URL, email?: string): Promise<Response> {
  const guildId = url.searchParams.get('guild')
  const guildless = url.pathname.endsWith('/me') || url.pathname.endsWith('/guilds') || url.pathname.endsWith('/import-kv')
  if (!guildId && !guildless) {
    return json({ error: 'guild query param required' }, 400)
  }

  const path = url.pathname.slice('/admin/api'.length)
  const method = req.method
  const body = (method === 'POST' || method === 'PATCH') && req.headers.get('content-type')?.includes('json')
    ? await req.json<any>().catch(() => ({}))
    : {}

  const route = async (): Promise<Response> => {
    if (path === '/me' && method === 'GET') return json({ email })
    if (path === '/guilds' && method === 'GET') return await listGuilds(env)
    if (path === '/import-kv' && method === 'POST') return await importFromKv(env)
    if (path === '/log' && method === 'GET') return json(await getAudit(env.DB, guildId!))
    if (path === '/history' && method === 'GET') return await listHistory(env, guildId!, url.searchParams)
    const hm = path.match(/^\/history\/([^/]+)$/)
    if (hm && method === 'GET') return await getHistoryDetail(env, guildId!, hm[1]!)
    if (path === '/parties' && method === 'GET') return json(await parties.listParties(env.DB, guildId!))
    if (path === '/parties' && method === 'POST') return await createOne(env, guildId!, body)
    if (path === '/channels' && method === 'GET') return await listChannels(env, guildId!, url.searchParams.get('kind'))
    if (path === '/members/resolve' && method === 'GET') return await resolveMembers(env, guildId!, url.searchParams.get('ids'))
    if (path === '/members/avatars' && method === 'GET') return await memberAvatars(env, guildId!, url.searchParams.get('ids'))
    if (path === '/members' && method === 'GET') return await searchMembers(env, guildId!, url.searchParams.get('q'))
    if (path === '/clear' && method === 'POST') return await clearAllParties(env, guildId!)
    if (path === '/settings' && method === 'GET') return json(await getGuildSettings(env.DB, guildId!))
    if (path === '/settings' && method === 'PATCH') return await patchSettings(env, guildId!, body)
    if (path === '/templates' && method === 'GET') return json(await getTemplates(env.DB, guildId!))
    if (path === '/templates' && method === 'POST') return await createTemplateRoute(env, guildId!, body)

    const tm = path.match(/^\/templates\/([^/]+)(\/.*)?$/)
    if (tm) {
      const templateId = tm[1]!
      const sub = tm[2] ?? ''
      if (sub === '' && method === 'PATCH')  return await updateTemplateRoute(env, guildId!, templateId, body)
      if (sub === '' && method === 'DELETE') return await deleteTemplateRoute(env, guildId!, templateId)
      if (sub === '/apply' && method === 'POST') return await applyTemplate(env, guildId!, templateId, body)
    }

    const m = path.match(/^\/parties\/([^/]+)(\/.*)?$/)
    if (m) {
      const partyId = m[1]!
      const sub = m[2] ?? ''
      const G = guildId!

      if (sub === '' && method === 'GET')    return await getOne(env, G, partyId)
      if (sub === '' && method === 'PATCH')  return await patchOne(env, G, partyId, body)
      if (sub === '' && method === 'DELETE') return await disbandOne(env, G, partyId)
      if (sub === '/close' && method === 'POST') return await closeOne(env, G, partyId)
      if (sub === '/open'  && method === 'POST') return await openOne(env, G, partyId)
      if (sub === '/bump'  && method === 'POST') return await bumpOne(env, G, partyId, body)
      if (sub === '/voice' && method === 'GET')  return await voiceStatus(env, G, partyId)
      if (sub === '/games' && method === 'GET')  return await partyGames(env, G, partyId)
      if (sub === '/banlist' && method === 'PATCH') return await setBanlistRoute(env, G, partyId, body)
      if (sub === '/members' && method === 'POST') return await addMember(env, G, partyId, body)

      const mm = sub.match(/^\/members\/([^/]+)(\/.*)?$/)
      if (mm) {
        const userId = mm[1]!
        const op = mm[2] ?? ''
        if (op === '' && method === 'DELETE') return await removeMemberRoute(env, G, partyId, userId)
        if (op === '/approve' && method === 'POST') return await approveQueuedRoute(env, G, partyId, userId)
        if (op === '/promote' && method === 'POST') return await promoteMemberRoute(env, G, partyId, userId)
      }

      const qmv = sub.match(/^\/queue\/([^/]+)\/move$/)
      if (qmv && method === 'POST') return await moveQueuedRoute(env, G, partyId, qmv[1]!, body)

      const qm = sub.match(/^\/queue\/([^/]+)$/)
      if (qm && method === 'DELETE') return await denyQueuedRoute(env, G, partyId, qm[1]!)
    }

    const um = path.match(/^\/users\/([^/]+)(\/.*)?$/)
    if (um) {
      const userId = um[1]!
      const op = um[2] ?? ''
      if (op === '' && method === 'GET') return await getUser(env, guildId!, userId)
      if (op === '/profile' && method === 'PATCH') return await patchUserProfile(env, guildId!, userId, body)
    }

    return json({ error: 'Not found' }, 404)
  }

  try {
    const res = await route()
    // Central audit trail: every successful mutation, attributed to the
    // Access-authenticated admin.
    if (guildId && method !== 'GET' && res.status < 400) {
      await appendAudit(env.DB, guildId, { ts: Date.now(), email, method, path })
        .catch(e => console.warn('audit append failed:', e))
    }
    return res
  } catch (e) {
    console.error('admin api error:', e)
    return json({ error: (e as Error).message ?? 'internal error' }, 500)
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function patchSettings(env: AppBindings, guildId: string, body: any): Promise<Response> {
  const current = await getGuildSettings(env.DB, guildId)

  if (body.maxParties != null) {
    const n = Number(body.maxParties)
    if (!Number.isInteger(n) || n < 1 || n > 50) return json({ error: 'maxParties must be 1–50' }, 400)
  }
  if (body.defaultCap != null) {
    const n = Number(body.defaultCap)
    if (!Number.isInteger(n) || n < 2 || n > 50) return json({ error: 'defaultCap must be 2–50' }, 400)
  }
  if (body.clientInviters != null && !Array.isArray(body.clientInviters)) {
    return json({ error: 'clientInviters must be an array of user IDs' }, 400)
  }
  if (body.partyBumpers != null && !Array.isArray(body.partyBumpers)) {
    return json({ error: 'partyBumpers must be an array of user IDs' }, 400)
  }

  const settings = sanitizeSettings({ ...current, ...body })
  await saveGuildSettings(env.DB, guildId, settings)
  return json(settings)
}

// ── Party history ─────────────────────────────────────────────────────────────

async function listHistory(env: AppBindings, guildId: string, params: URLSearchParams): Promise<Response> {
  const limit = Math.min(Math.max(Number(params.get('limit')) || 100, 1), 200)
  const offset = Math.max(Number(params.get('offset')) || 0, 0)
  return json(await history.listSessions(env.DB, guildId, limit, offset))
}

async function getHistoryDetail(env: AppBindings, guildId: string, idRaw: string): Promise<Response> {
  const historyId = Number(idRaw)
  if (!Number.isInteger(historyId)) return json({ error: 'Invalid history id' }, 400)
  const session = await history.getSession(env.DB, guildId, historyId)
  if (!session) return json({ error: 'History not found' }, 404)
  const [events, gameList] = await Promise.all([
    history.getSessionEvents(env.DB, historyId),
    games.listGamesForHistory(env.DB, historyId),
  ])
  return json({ session, events, games: gameList })
}

/** Games recorded for a live party's current session (empty if none). */
async function partyGames(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const historyId = await history.activeSessionId(env.DB, guildId, partyId)
  if (historyId == null) return json({ historyId: null, games: [] })
  return json({ historyId, games: await games.listGamesForHistory(env.DB, historyId) })
}

async function listGuilds(env: AppBindings): Promise<Response> {
  const guilds = await getBotGuilds(env.DISCORD_BOT_TOKEN).catch(() => [])
  return json(guilds.map(g => ({ id: g.id, name: g.name, icon: g.icon })))
}

async function listChannels(env: AppBindings, guildId: string, kind: string | null): Promise<Response> {
  const type = kind === 'text' ? 0 : 2  // default voice, for back-compat
  const channels = await getGuildChannels(env.DISCORD_BOT_TOKEN, guildId).catch(() => [])
  return json(channels.filter(c => c.type === type).map(c => ({ id: c.id, name: c.name })))
}

async function searchMembers(env: AppBindings, guildId: string, q: string | null): Promise<Response> {
  const query = (q ?? '').trim()
  if (query.length < 2) return json([])
  const members = await searchGuildMembers(env.DISCORD_BOT_TOKEN, guildId, query).catch(() => [])
  return json(members.map(m => ({
    id: m.user.id,
    username: m.user.username,
    displayName: m.nick ?? m.user.global_name ?? m.user.username,
  })))
}

/**
 * Resolve a batch of user IDs to display names for the settings allowlists.
 * Prefers the guild nickname/name; falls back to the global username so members
 * who have left the guild still show a name rather than a bare ID. Runs in small
 * concurrent batches to stay clear of Discord's rate limits.
 */
async function resolveMembers(env: AppBindings, guildId: string, idsParam: string | null): Promise<Response> {
  const ids = [...new Set((idsParam ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 100)
  const names: Record<string, string> = {}
  const BATCH = 5
  for (let i = 0; i < ids.length; i += BATCH) {
    await Promise.all(ids.slice(i, i + BATCH).map(async id => {
      const member = await getGuildMember(env.DISCORD_BOT_TOKEN, guildId, id).catch(() => null)
      if (member?.user) {
        names[id] = member.nick ?? member.user.global_name ?? member.user.username
        return
      }
      const user = await getUserById(env.DISCORD_BOT_TOKEN, id).catch(() => null)
      if (user) names[id] = user.global_name ?? user.username
    }))
  }
  return json(names)
}

/**
 * Resolve a batch of user IDs to their Discord avatar CDN URLs, so the parties
 * page can show profile pictures instead of coloured initials. A null value
 * means the member uses a default avatar (the UI falls back to initials).
 * Backed by the same 6h-cached resolver the desktop client uses, so repeated
 * detail-page loads stay cheap on Discord's API.
 */
async function memberAvatars(env: AppBindings, guildId: string, idsParam: string | null): Promise<Response> {
  const ids = [...new Set((idsParam ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 100)
  const urls: Record<string, string | null> = {}
  const BATCH = 5
  for (let i = 0; i < ids.length; i += BATCH) {
    await Promise.all(ids.slice(i, i + BATCH).map(async id => {
      urls[id] = await getMemberAvatarUrl(env.DISCORD_BOT_TOKEN, guildId, id).catch(() => null)
    }))
  }
  return json(urls)
}

async function getOne(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  return party ? json(party) : json({ error: 'Party not found' }, 404)
}

async function patchOne(env: AppBindings, guildId: string, partyId: string, body: any): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)

  let ignMap: Record<string, string> | undefined
  if (body.game && party.game !== body.game) {
    const ids = [...party.members.map(m => m.userId), ...party.queue.map(q => q.userId)]
    ignMap = await getIgnMap(env.DB, ids, body.game)
  }

  // Admin acts as the party's current owner, so the owner-only checks pass.
  const result = await parties.updateParty(env.DB, guildId, partyId, {
    requesterId: party.ownerId,
    name: body.name,
    description: body.description,
    maxSize: body.maxSize,
    game: body.game,
    voiceChannelId: body.voiceChannelId,
    ignMap,
  })

  if (result.status === 'not_found') return json({ error: 'Party not found' }, 404)
  if (result.status === 'invalid') return json({ error: result.message }, 400)
  if (result.status === 'unauthorized') return json({ error: 'update failed' }, 500)

  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

/**
 * Shared core behind both "create a party" and "apply a template": validate the
 * owner/channel/game/cap, spin up the party + embed, and optionally seed a
 * banlist. `body` carries the resolved party fields.
 */
async function spawnParty(env: AppBindings, guildId: string, body: any): Promise<Response> {
  const ownerId = (body.ownerId ?? '').toString().trim()
  const channelId = (body.channelId ?? '').toString().trim()
  if (!ownerId) return json({ error: 'ownerId required' }, 400)
  if (!channelId) return json({ error: 'channelId (text channel for the embed) required' }, 400)

  const [settings, partyCount, existingPartyId, member] = await Promise.all([
    getGuildSettings(env.DB, guildId),
    parties.countParties(env.DB, guildId),
    parties.getUserPartyId(env.DB, guildId, ownerId),
    getGuildMember(env.DISCORD_BOT_TOKEN, guildId, ownerId).catch(() => null),
  ])

  if (partyCount >= settings.maxParties) return json({ error: `Guild already has ${settings.maxParties} active parties` }, 400)
  if (existingPartyId) return json({ error: `Owner is already in party ${existingPartyId}` }, 400)
  if (!member?.user) return json({ error: 'Owner is not in this guild' }, 404)

  const game = (body.game ?? 'Other').toString()
  if (!GAMES.some(g => g.value === game)) return json({ error: 'Unknown game' }, 400)
  if (!gameAllowed(settings, game)) return json({ error: `${game} is not enabled on this server` }, 400)

  const maxSize = body.maxSize != null ? Number(body.maxSize) : settings.defaultCap
  if (!Number.isInteger(maxSize) || maxSize < 2 || maxSize > 50) return json({ error: 'maxSize must be 2–50' }, 400)

  const displayName = member.nick ?? member.user.global_name ?? member.user.username
  const ign = await getUserIgn(env.DB, ownerId, game)

  const result = await createPartyAndEmbed(env, {
    guildId,
    channelId,
    owner: { id: ownerId, username: member.user.username, displayName, ign },
    name: (body.name ?? '').toString().trim().slice(0, 100) || `${displayName}'s party`,
    description: (body.description ?? '').toString().slice(0, 1000),
    game,
    maxSize,
    voiceChannelId: (body.voiceChannelId ?? '').toString() || undefined,
  })
  if (!result.ok) return json({ error: result.error }, 400)

  // Seed the banlist after creation — createPartyAndEmbed doesn't take one,
  // and the store assigns bans to the (currently just the owner) members.
  const banlist = (body.banlist ?? '').toString().trim()
  if (banlist) {
    const banned = await parties.setBanlist(env.DB, guildId, result.party.id, result.party.ownerId, banlist)
    if (banned.status === 'updated' && banned.data) {
      await trySyncEmbed(env.DISCORD_BOT_TOKEN, banned.data)
      return json(banned.data)
    }
  }
  return json(result.party)
}

async function createOne(env: AppBindings, guildId: string, body: any): Promise<Response> {
  return spawnParty(env, guildId, body)
}

async function createTemplateRoute(env: AppBindings, guildId: string, body: any): Promise<Response> {
  const result = await createTemplate(env.DB, guildId, body)
  if (!result.ok) return json({ error: result.error }, 400)
  return json(result.template)
}

async function updateTemplateRoute(env: AppBindings, guildId: string, id: string, body: any): Promise<Response> {
  const result = await updateTemplate(env.DB, guildId, id, body)
  if (!result.ok) return json({ error: result.error }, result.error === 'Template not found' ? 404 : 400)
  return json(result.template)
}

async function deleteTemplateRoute(env: AppBindings, guildId: string, id: string): Promise<Response> {
  const ok = await deleteTemplate(env.DB, guildId, id)
  return ok ? json({ status: 'deleted' }) : json({ error: 'Template not found' }, 404)
}

/** Create a live party from a saved template, overriding owner/channel/voice. */
async function applyTemplate(env: AppBindings, guildId: string, templateId: string, body: any): Promise<Response> {
  const template = await getTemplate(env.DB, guildId, templateId)
  if (!template) return json({ error: 'Template not found' }, 404)

  return spawnParty(env, guildId, {
    ownerId: body.ownerId,
    channelId: body.channelId,
    name: template.name,
    description: template.description,
    game: template.game,
    maxSize: template.maxSize,
    // Let the apply form override the template's voice channel when given.
    voiceChannelId: (body.voiceChannelId ?? '').toString() || template.voiceChannelId,
    banlist: template.banlist,
  })
}

async function bumpOne(env: AppBindings, guildId: string, partyId: string, body: any): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const channelId = (body.channelId ?? '').toString().trim() || party.embedChannelId
  if (!channelId) return json({ error: 'No channel known for this party — pass channelId' }, 400)
  await repostPartyEmbed(env, party, channelId)
  return json(await parties.getParty(env.DB, guildId, partyId))
}

async function voiceStatus(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)

  const states = await Promise.all(party.members.map(async m => ({
    userId: m.userId,
    channelId: await getUserVoiceChannel(env.DISCORD_BOT_TOKEN, guildId, m.userId).catch(() => null),
  })))

  return json({ voiceChannelId: party.voiceChannelId ?? null, states })
}

async function getUser(env: AppBindings, guildId: string, userId: string): Promise<Response> {
  const [profile, partyId, member] = await Promise.all([
    getUserProfile(env.DB, userId),
    parties.getUserPartyId(env.DB, guildId, userId),
    getGuildMember(env.DISCORD_BOT_TOKEN, guildId, userId).catch(() => null),
  ])

  return json({
    userId,
    profile,
    partyId,
    // Membership is a foreign-keyed row now — a mapping can't outlive its
    // party, so partyId set always means the user really is in that party.
    partyExists: !!partyId,
    inParty: !!partyId,
    member: member?.user
      ? { username: member.user.username, displayName: member.nick ?? member.user.global_name ?? member.user.username }
      : null,
  })
}

async function patchUserProfile(env: AppBindings, guildId: string, userId: string, body: any): Promise<Response> {
  const game = (body.game ?? '').toString()
  if (!GAMES.some(g => g.value === game)) return json({ error: 'Unknown game' }, 400)
  const ign = (body.ign ?? '').toString().trim().slice(0, 100)

  await saveUserIgn(env.DB, userId, game, ign)
  const profile = await getUserProfile(env.DB, userId)

  // Mirror /party ign: if they're in a party playing that game, refresh the
  // live member IGN and embed too.
  const partyId = await parties.getUserPartyId(env.DB, guildId, userId)
  if (partyId) {
    const party = await parties.getParty(env.DB, guildId, partyId)
    if (party && party.game === game) {
      const result = await parties.setMemberIgn(env.DB, guildId, partyId, userId, ign || undefined)
      if (result.status === 'updated') await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
    }
  }

  return json(profile)
}

async function moveQueuedRoute(env: AppBindings, guildId: string, partyId: string, userId: string, body: any): Promise<Response> {
  const direction = body.direction === 'up' ? 'up' : 'down'
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await parties.moveQueued(env.DB, guildId, partyId, party.ownerId, userId, direction)
  if (result.status === 'not_found') return json({ error: 'Party not found' }, 404)
  if (result.status === 'not_queued') return json({ error: 'Not in queue' }, 404)
  if (result.status === 'moved') await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function disbandOne(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const result = await parties.disbandParty(env.DB, guildId, partyId)
  if (result.status !== 'disbanded' || !result.data) {
    return json({ error: 'already gone' }, 404)
  }
  await tryMarkDisbanded(env.DISCORD_BOT_TOKEN, result.data, 'disbanded by admin')
  return json({ status: 'disbanded' })
}

async function clearAllParties(env: AppBindings, guildId: string): Promise<Response> {
  const cleared = await parties.disbandAllParties(env.DB, guildId)
  await Promise.all(cleared.map(party => tryMarkDisbanded(env.DISCORD_BOT_TOKEN, party, 'cleared by admin')))
  return json({ status: 'cleared', count: cleared.length })
}

async function closeOne(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await parties.closeParty(env.DB, guildId, partyId, party.ownerId)
  if (result.status === 'already_closed') return json({ error: 'already closed' }, 400)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function openOne(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await parties.openParty(env.DB, guildId, partyId, party.ownerId)
  if (result.status === 'already_open') return json({ error: 'already open' }, 400)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function setBanlistRoute(env: AppBindings, guildId: string, partyId: string, body: any): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await parties.setBanlist(env.DB, guildId, partyId, party.ownerId, (body.banlist ?? '').toString())
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function addMember(env: AppBindings, guildId: string, partyId: string, body: any): Promise<Response> {
  const targetId = (body.userId ?? '').toString().trim()
  if (!targetId) return json({ error: 'userId required' }, 400)

  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)

  const existingPartyId = await parties.getUserPartyId(env.DB, guildId, targetId)
  if (existingPartyId && existingPartyId !== partyId) {
    return json({ error: `User is already in party ${existingPartyId}` }, 400)
  }

  const member = await getGuildMember(env.DISCORD_BOT_TOKEN, guildId, targetId).catch(() => null)
  if (!member?.user) return json({ error: 'User not in this guild' }, 404)

  const ign = await getUserIgn(env.DB, targetId, party.game)
  const result = await parties.forceAdd(env.DB, guildId, partyId, party.ownerId, {
    userId: targetId,
    username: member.user.username,
    displayName: member.nick ?? member.user.global_name ?? member.user.username,
    ign,
  })

  if (result.status === 'not_found')      return json({ error: 'Party not found' }, 404)
  if (result.status === 'already_member') return json({ error: 'Already a member' }, 400)
  if (result.status === 'in_other_party') return json({ error: 'User is already in another party' }, 400)
  if (result.status === 'full')           return json({ error: 'Party is full' }, 400)

  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function removeMemberRoute(env: AppBindings, guildId: string, partyId: string, userId: string): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await parties.removeMember(env.DB, guildId, partyId, party.ownerId, userId)
  if (result.status === 'not_found') return json({ error: 'Party not found' }, 404)
  if (result.status === 'is_owner') return json({ error: "Can't remove the owner — promote someone else first" }, 400)
  if (result.status === 'not_in')   return json({ error: 'Not in party' }, 404)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function approveQueuedRoute(env: AppBindings, guildId: string, partyId: string, userId: string): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await parties.approveQueued(env.DB, guildId, partyId, party.ownerId, userId)
  if (result.status === 'not_found') return json({ error: 'Party not found' }, 404)
  if (result.status === 'not_queued') return json({ error: 'Not in queue' }, 404)
  if (result.status === 'full')       return json({ error: 'Party is full' }, 400)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function denyQueuedRoute(env: AppBindings, guildId: string, partyId: string, userId: string): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await parties.denyQueued(env.DB, guildId, partyId, party.ownerId, userId)
  if (result.status === 'not_found') return json({ error: 'Party not found' }, 404)
  if (result.status === 'not_queued') return json({ error: 'Not in queue' }, 404)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function promoteMemberRoute(env: AppBindings, guildId: string, partyId: string, userId: string): Promise<Response> {
  const party = await parties.getParty(env.DB, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await parties.promoteOwner(env.DB, guildId, partyId, party.ownerId, userId)
  if (result.status === 'not_found') return json({ error: 'Party not found' }, 404)
  if (result.status === 'already_owner') return json({ error: 'Already owner' }, 400)
  if (result.status === 'not_in')        return json({ error: 'Not in party' }, 404)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}
