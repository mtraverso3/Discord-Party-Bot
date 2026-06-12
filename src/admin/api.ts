import type { AppBindings, MoveQueueResult, PartyData, UpdateResult } from '../types'
import {
  callParty, createPartyAndEmbed, getPartyIndex, getPartyStub, getUserPartyId,
  getUserProfile, markDisbanded, removeFromIndex, repostPartyEmbed,
  saveUserProfile, setUserPartyId, trySyncEmbed, updateIndexEntry,
} from '../lib/party'
import { GAMES } from '../lib/games'
import { gameAllowed } from '../lib/settings'
import { getGuildSettings, sanitizeSettings, saveGuildSettings } from '../lib/settings'
import { createTemplate, deleteTemplate, getTemplate, getTemplates, updateTemplate } from '../lib/templates'
import { appendAudit, getAudit } from '../lib/audit'
import { getBotGuilds, getGuildChannels, getGuildMember, getUserVoiceChannel, searchGuildMembers } from '../lib/discord'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Admin acts as the party's current owner when invoking DO actions, so the
 * existing owner-only checks pass without us touching the DO surface.
 */
async function asOwner(env: AppBindings, guildId: string, partyId: string) {
  const stub = getPartyStub(env, guildId, partyId)
  const party = await callParty<PartyData | null>(stub, 'get').catch(() => null)
  return { stub, party }
}

export async function handleAdminApi(req: Request, env: AppBindings, url: URL, email?: string): Promise<Response> {
  const guildId = url.searchParams.get('guild')
  const guildless = url.pathname.endsWith('/me') || url.pathname.endsWith('/guilds')
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
    if (path === '/log' && method === 'GET') return json(await getAudit(env.PARTY_KV, guildId!))
    if (path === '/parties' && method === 'GET') return await listParties(env, guildId!)
    if (path === '/parties' && method === 'POST') return await createOne(env, guildId!, body)
    if (path === '/channels' && method === 'GET') return await listChannels(env, guildId!, url.searchParams.get('kind'))
    if (path === '/members' && method === 'GET') return await searchMembers(env, guildId!, url.searchParams.get('q'))
    if (path === '/clear' && method === 'POST') return await clearAllParties(env, guildId!)
    if (path === '/settings' && method === 'GET') return json(await getGuildSettings(env.PARTY_KV, guildId!))
    if (path === '/settings' && method === 'PATCH') return await patchSettings(env, guildId!, body)
    if (path === '/templates' && method === 'GET') return json(await getTemplates(env.PARTY_KV, guildId!))
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
      if (sub === '/banlist' && method === 'PATCH') return await setBanlist(env, G, partyId, body)
      if (sub === '/members' && method === 'POST') return await addMember(env, G, partyId, body)

      const mm = sub.match(/^\/members\/([^/]+)(\/.*)?$/)
      if (mm) {
        const userId = mm[1]!
        const op = mm[2] ?? ''
        if (op === '' && method === 'DELETE') return await removeMember(env, G, partyId, userId)
        if (op === '/approve' && method === 'POST') return await approveQueued(env, G, partyId, userId)
        if (op === '/promote' && method === 'POST') return await promoteMember(env, G, partyId, userId)
      }

      const qmv = sub.match(/^\/queue\/([^/]+)\/move$/)
      if (qmv && method === 'POST') return await moveQueued(env, G, partyId, qmv[1]!, body)

      const qm = sub.match(/^\/queue\/([^/]+)$/)
      if (qm && method === 'DELETE') return await denyQueued(env, G, partyId, qm[1]!)
    }

    const um = path.match(/^\/users\/([^/]+)(\/.*)?$/)
    if (um) {
      const userId = um[1]!
      const op = um[2] ?? ''
      if (op === '' && method === 'GET') return await getUser(env, guildId!, userId)
      if (op === '/profile' && method === 'PATCH') return await patchUserProfile(env, guildId!, userId, body)
      if (op === '/unstick' && method === 'POST') return await unstickUser(env, guildId!, userId)
    }

    return json({ error: 'Not found' }, 404)
  }

  try {
    const res = await route()
    // Central audit trail: every successful mutation, attributed to the
    // Access-authenticated admin.
    if (guildId && method !== 'GET' && res.status < 400) {
      await appendAudit(env.PARTY_KV, guildId, { ts: Date.now(), email, method, path })
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
  const current = await getGuildSettings(env.PARTY_KV, guildId)

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

  const settings = sanitizeSettings({ ...current, ...body })
  await saveGuildSettings(env.PARTY_KV, guildId, settings)
  return json(settings)
}

async function listParties(env: AppBindings, guildId: string): Promise<Response> {
  const index = await getPartyIndex(env.PARTY_KV, guildId)
  const parties = await Promise.all(index.map(async e => {
    const stub = getPartyStub(env, guildId, e.id)
    return callParty<PartyData | null>(stub, 'get').catch(() => null)
  }))
  return json(parties.filter(Boolean))
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

async function getOne(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const { party } = await asOwner(env, guildId, partyId)
  return party ? json(party) : json({ error: 'Party not found' }, 404)
}

async function patchOne(env: AppBindings, guildId: string, partyId: string, body: any): Promise<Response> {
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)

  let ignMap: Record<string, string> | undefined
  if (body.game && party.game !== body.game) {
    const ids = [...party.members.map(m => m.userId), ...party.queue.map(q => q.userId)]
    const profiles = await Promise.all(ids.map(uid => getUserProfile(env.PARTY_KV, uid)))
    ignMap = {}
    ids.forEach((uid, i) => {
      const ign = profiles[i]!.igns[body.game]
      if (ign) ignMap![uid] = ign
    })
  }

  const result = await callParty<UpdateResult>(stub, 'update', {
    requesterId: party.ownerId,
    name: body.name,
    description: body.description,
    maxSize: body.maxSize,
    game: body.game,
    voiceChannelId: body.voiceChannelId,
    ignMap,
  }).catch(() => null)

  if (!result) return json({ error: 'update failed' }, 500)
  if (result.status === 'invalid') return json({ error: result.message }, 400)

  const patch: { name?: string; game?: string } = {}
  if (result.nameChanged) patch.name = result.data.name
  if (result.gameChanged) patch.game = result.data.game
  if (patch.name || patch.game) await updateIndexEntry(env.PARTY_KV, guildId, partyId, patch)

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

  const [settings, index, existingPartyId, member] = await Promise.all([
    getGuildSettings(env.PARTY_KV, guildId),
    getPartyIndex(env.PARTY_KV, guildId),
    getUserPartyId(env.PARTY_KV, guildId, ownerId),
    getGuildMember(env.DISCORD_BOT_TOKEN, guildId, ownerId).catch(() => null),
  ])

  if (index.length >= settings.maxParties) return json({ error: `Guild already has ${settings.maxParties} active parties` }, 400)
  if (existingPartyId) return json({ error: `Owner is already in party ${existingPartyId}` }, 400)
  if (!member?.user) return json({ error: 'Owner is not in this guild' }, 404)

  const game = (body.game ?? 'Other').toString()
  if (!GAMES.some(g => g.value === game)) return json({ error: 'Unknown game' }, 400)
  if (!gameAllowed(settings, game)) return json({ error: `${game} is not enabled on this server` }, 400)

  const maxSize = body.maxSize != null ? Number(body.maxSize) : settings.defaultCap
  if (!Number.isInteger(maxSize) || maxSize < 2 || maxSize > 50) return json({ error: 'maxSize must be 2–50' }, 400)

  const displayName = member.nick ?? member.user.global_name ?? member.user.username
  const profile = await getUserProfile(env.PARTY_KV, ownerId)

  const result = await createPartyAndEmbed(env, {
    guildId,
    channelId,
    owner: { id: ownerId, username: member.user.username, displayName, ign: profile.igns[game] },
    name: (body.name ?? '').toString().trim().slice(0, 100) || `${displayName}'s party`,
    description: (body.description ?? '').toString().slice(0, 1000),
    game,
    maxSize,
    voiceChannelId: (body.voiceChannelId ?? '').toString() || undefined,
  })
  if (!result.ok) return json({ error: result.error }, 400)

  // Seed the banlist after creation — createPartyAndEmbed doesn't take one, and
  // the DO assigns bans to the (currently just the owner) members itself.
  const banlist = (body.banlist ?? '').toString().trim()
  if (banlist) {
    const stub = getPartyStub(env, guildId, result.party.id)
    const banned = await callParty<{ status: string; data: PartyData }>(stub, 'setbanlist', {
      requesterId: result.party.ownerId, banlist,
    }).catch(() => null)
    if (banned?.status === 'updated') {
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
  const result = await createTemplate(env.PARTY_KV, guildId, body)
  if (!result.ok) return json({ error: result.error }, 400)
  return json(result.template)
}

async function updateTemplateRoute(env: AppBindings, guildId: string, id: string, body: any): Promise<Response> {
  const result = await updateTemplate(env.PARTY_KV, guildId, id, body)
  if (!result.ok) return json({ error: result.error }, result.error === 'Template not found' ? 404 : 400)
  return json(result.template)
}

async function deleteTemplateRoute(env: AppBindings, guildId: string, id: string): Promise<Response> {
  const ok = await deleteTemplate(env.PARTY_KV, guildId, id)
  return ok ? json({ status: 'deleted' }) : json({ error: 'Template not found' }, 404)
}

/** Create a live party from a saved template, overriding owner/channel/voice. */
async function applyTemplate(env: AppBindings, guildId: string, templateId: string, body: any): Promise<Response> {
  const template = await getTemplate(env.PARTY_KV, guildId, templateId)
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
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const channelId = (body.channelId ?? '').toString().trim() || party.embedChannelId
  if (!channelId) return json({ error: 'No channel known for this party — pass channelId' }, 400)
  await repostPartyEmbed(env, stub, party, channelId)
  return json(await callParty<PartyData | null>(stub, 'get'))
}

async function voiceStatus(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const { party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)

  const states = await Promise.all(party.members.map(async m => ({
    userId: m.userId,
    channelId: await getUserVoiceChannel(env.DISCORD_BOT_TOKEN, guildId, m.userId).catch(() => null),
  })))

  return json({ voiceChannelId: party.voiceChannelId ?? null, states })
}

async function getUser(env: AppBindings, guildId: string, userId: string): Promise<Response> {
  const [profile, partyId, member] = await Promise.all([
    getUserProfile(env.PARTY_KV, userId),
    getUserPartyId(env.PARTY_KV, guildId, userId),
    getGuildMember(env.DISCORD_BOT_TOKEN, guildId, userId).catch(() => null),
  ])

  let partyExists = false
  let inParty = false
  if (partyId) {
    const party = await callParty<PartyData | null>(getPartyStub(env, guildId, partyId), 'get').catch(() => null)
    partyExists = !!party
    inParty = !!party && (party.members.some(m => m.userId === userId) || party.queue.some(q => q.userId === userId))
  }

  return json({
    userId,
    profile,
    partyId,
    partyExists,
    inParty,  // false with a partyId set means the mapping is stale
    member: member?.user
      ? { username: member.user.username, displayName: member.nick ?? member.user.global_name ?? member.user.username }
      : null,
  })
}

async function patchUserProfile(env: AppBindings, guildId: string, userId: string, body: any): Promise<Response> {
  const game = (body.game ?? '').toString()
  if (!GAMES.some(g => g.value === game)) return json({ error: 'Unknown game' }, 400)
  const ign = (body.ign ?? '').toString().trim().slice(0, 100)

  const profile = await getUserProfile(env.PARTY_KV, userId)
  if (ign) profile.igns[game] = ign
  else delete profile.igns[game]
  await saveUserProfile(env.PARTY_KV, userId, profile)

  // Mirror /party ign: if they're in a party playing that game, refresh the
  // live member IGN and embed too.
  const partyId = await getUserPartyId(env.PARTY_KV, guildId, userId)
  if (partyId) {
    const stub = getPartyStub(env, guildId, partyId)
    const party = await callParty<PartyData | null>(stub, 'get').catch(() => null)
    if (party && party.game === game) {
      const result = await callParty<{ status: string; data: PartyData }>(
        stub, 'setign', { userId, ign: ign || undefined },
      ).catch(() => null)
      if (result?.status === 'updated') await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
    }
  }

  return json(profile)
}

async function unstickUser(env: AppBindings, guildId: string, userId: string): Promise<Response> {
  const partyId = await getUserPartyId(env.PARTY_KV, guildId, userId)
  if (!partyId) return json({ error: 'User has no party mapping' }, 400)

  const party = await callParty<PartyData | null>(getPartyStub(env, guildId, partyId), 'get').catch(() => null)
  const inParty = !!party && (party.members.some(m => m.userId === userId) || party.queue.some(q => q.userId === userId))
  if (inParty) return json({ error: 'Mapping is not stale — the user really is in that party. Remove them instead.' }, 400)

  await setUserPartyId(env.PARTY_KV, guildId, userId, null)
  return json({ status: 'cleared', partyId })
}

async function moveQueued(env: AppBindings, guildId: string, partyId: string, userId: string, body: any): Promise<Response> {
  const direction = body.direction === 'up' ? 'up' : 'down'
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await callParty<MoveQueueResult>(stub, 'movequeue', {
    requesterId: party.ownerId, userId, direction,
  })
  if (result.status === 'not_queued') return json({ error: 'Not in queue' }, 404)
  if (result.status === 'moved') await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function disbandOne(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const stub = getPartyStub(env, guildId, partyId)
  const result = await callParty<{ status: string; data?: PartyData }>(stub, 'forcedisband').catch(() => null)
  if (!result || result.status === 'gone' || !result.data) {
    return json({ error: 'already gone' }, 404)
  }
  const party = result.data
  await Promise.all([
    ...party.members.map(m => setUserPartyId(env.PARTY_KV, guildId, m.userId, null)),
    ...party.queue.map(q => setUserPartyId(env.PARTY_KV, guildId, q.userId, null)),
    removeFromIndex(env.PARTY_KV, guildId, partyId),
    markDisbanded(env.DISCORD_BOT_TOKEN, party, 'disbanded by admin')
      .catch(e => console.warn(`markDisbanded failed for party ${partyId}:`, e)),
  ])
  return json({ status: 'disbanded' })
}

async function clearAllParties(env: AppBindings, guildId: string): Promise<Response> {
  const index = await getPartyIndex(env.PARTY_KV, guildId)
  let cleared = 0
  await Promise.all(index.map(async entry => {
    const stub = getPartyStub(env, guildId, entry.id)
    const result = await callParty<{ status: string; data?: PartyData }>(stub, 'forcedisband').catch(() => null)
    if (!result || result.status === 'gone' || !result.data) return
    cleared++
    const party = result.data
    await Promise.all([
      ...party.members.map(m => setUserPartyId(env.PARTY_KV, guildId, m.userId, null)),
      ...party.queue.map(q => setUserPartyId(env.PARTY_KV, guildId, q.userId, null)),
      markDisbanded(env.DISCORD_BOT_TOKEN, party, 'cleared by admin')
        .catch(e => console.warn(`markDisbanded failed for party ${entry.id}:`, e)),
    ])
  }))
  await env.PARTY_KV.put(`guild:${guildId}:parties`, JSON.stringify([]))
  return json({ status: 'cleared', count: cleared })
}

async function closeOne(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'close', { requesterId: party.ownerId })
  if (result.status === 'already_closed') return json({ error: 'already closed' }, 400)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function openOne(env: AppBindings, guildId: string, partyId: string): Promise<Response> {
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'open', { requesterId: party.ownerId })
  if (result.status === 'already_open') return json({ error: 'already open' }, 400)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function setBanlist(env: AppBindings, guildId: string, partyId: string, body: any): Promise<Response> {
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'setbanlist', {
    requesterId: party.ownerId,
    banlist: body.banlist ?? '',
  })
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function addMember(env: AppBindings, guildId: string, partyId: string, body: any): Promise<Response> {
  const targetId = (body.userId ?? '').toString().trim()
  if (!targetId) return json({ error: 'userId required' }, 400)

  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)

  const existingPartyId = await getUserPartyId(env.PARTY_KV, guildId, targetId)
  if (existingPartyId && existingPartyId !== partyId) {
    return json({ error: `User is already in party ${existingPartyId}` }, 400)
  }

  const member = await getGuildMember(env.DISCORD_BOT_TOKEN, guildId, targetId).catch(() => null)
  if (!member?.user) return json({ error: 'User not in this guild' }, 404)

  const profile = await getUserProfile(env.PARTY_KV, targetId)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'forceadd', {
    requesterId: party.ownerId,
    userId: targetId,
    username: member.user.username,
    displayName: member.nick ?? member.user.global_name ?? member.user.username,
    ign: profile.igns[party.game],
  })

  if (result.status === 'already_member') return json({ error: 'Already a member' }, 400)
  if (result.status === 'full')           return json({ error: 'Party is full' }, 400)

  await setUserPartyId(env.PARTY_KV, guildId, targetId, partyId)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function removeMember(env: AppBindings, guildId: string, partyId: string, userId: string): Promise<Response> {
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await callParty<{ status: string; data: PartyData; promoted?: string }>(stub, 'remove', {
    requesterId: party.ownerId, userId,
  })
  if (result.status === 'is_owner') return json({ error: "Can't remove the owner — promote someone else first" }, 400)
  if (result.status === 'not_in')   return json({ error: 'Not in party' }, 404)
  await setUserPartyId(env.PARTY_KV, guildId, userId, null)
  if (result.promoted) await setUserPartyId(env.PARTY_KV, guildId, result.promoted, partyId)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function approveQueued(env: AppBindings, guildId: string, partyId: string, userId: string): Promise<Response> {
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'approve', {
    requesterId: party.ownerId, userId,
  })
  if (result.status === 'not_queued') return json({ error: 'Not in queue' }, 404)
  if (result.status === 'full')       return json({ error: 'Party is full' }, 400)
  await setUserPartyId(env.PARTY_KV, guildId, userId, partyId)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function denyQueued(env: AppBindings, guildId: string, partyId: string, userId: string): Promise<Response> {
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'deny', {
    requesterId: party.ownerId, userId,
  })
  if (result.status === 'not_queued') return json({ error: 'Not in queue' }, 404)
  await setUserPartyId(env.PARTY_KV, guildId, userId, null)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}

async function promoteMember(env: AppBindings, guildId: string, partyId: string, userId: string): Promise<Response> {
  const { stub, party } = await asOwner(env, guildId, partyId)
  if (!party) return json({ error: 'Party not found' }, 404)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'promote', {
    requesterId: party.ownerId, userId,
  })
  if (result.status === 'already_owner') return json({ error: 'Already owner' }, 400)
  if (result.status === 'not_in')        return json({ error: 'Not in party' }, 404)
  await trySyncEmbed(env.DISCORD_BOT_TOKEN, result.data)
  return json(result.data)
}
