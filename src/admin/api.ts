import type { AppBindings, PartyData, UpdateResult } from '../types'
import {
  callParty, getPartyIndex, getPartyStub, getUserPartyId, getUserProfile,
  markDisbanded, removeFromIndex, setUserPartyId, trySyncEmbed, updateIndexEntry,
} from '../lib/party'
import { getGuildChannels, getGuildMember } from '../lib/discord'

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
  if (!guildId && !url.pathname.endsWith('/me')) {
    return json({ error: 'guild query param required' }, 400)
  }

  const path = url.pathname.slice('/admin/api'.length)
  const method = req.method
  const body = (method === 'POST' || method === 'PATCH') && req.headers.get('content-type')?.includes('json')
    ? await req.json<any>().catch(() => ({}))
    : {}

  try {
    if (path === '/me' && method === 'GET') return json({ email })
    if (path === '/parties' && method === 'GET') return await listParties(env, guildId!)
    if (path === '/channels' && method === 'GET') return await listVoiceChannels(env, guildId!)
    if (path === '/clear' && method === 'POST') return await clearAllParties(env, guildId!)

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

      const qm = sub.match(/^\/queue\/([^/]+)$/)
      if (qm && method === 'DELETE') return await denyQueued(env, G, partyId, qm[1]!)
    }

    return json({ error: 'Not found' }, 404)
  } catch (e) {
    console.error('admin api error:', e)
    return json({ error: (e as Error).message ?? 'internal error' }, 500)
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function listParties(env: AppBindings, guildId: string): Promise<Response> {
  const index = await getPartyIndex(env.PARTY_KV, guildId)
  const parties = await Promise.all(index.map(async e => {
    const stub = getPartyStub(env, guildId, e.id)
    return callParty<PartyData | null>(stub, 'get').catch(() => null)
  }))
  return json(parties.filter(Boolean))
}

async function listVoiceChannels(env: AppBindings, guildId: string): Promise<Response> {
  const channels = await getGuildChannels(env.DISCORD_BOT_TOKEN, guildId).catch(() => [])
  return json(channels.filter(c => c.type === 2).map(c => ({ id: c.id, name: c.name })))
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
