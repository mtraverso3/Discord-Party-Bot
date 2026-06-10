import type { AppBindings, PartyData, PartyIndexEntry, UserProfile } from '../types'
import { deleteMessage, editMessage, postMessage } from './discord'
import { buildDisbandedEmbed, buildPartyComponents, buildPartyEmbed } from './embeds'

// ── KV helpers ──────────────────────────────────────────────────────────────

export async function getPartyIndex(kv: KVNamespace, guildId: string): Promise<PartyIndexEntry[]> {
  const raw = await kv.get(`guild:${guildId}:parties`)
  return raw ? (JSON.parse(raw) as PartyIndexEntry[]) : []
}

async function savePartyIndex(kv: KVNamespace, guildId: string, index: PartyIndexEntry[]): Promise<void> {
  await kv.put(`guild:${guildId}:parties`, JSON.stringify(index))
}

export async function addToIndex(kv: KVNamespace, guildId: string, entry: PartyIndexEntry): Promise<void> {
  const index = await getPartyIndex(kv, guildId)
  index.push(entry)
  await savePartyIndex(kv, guildId, index)
}

export async function removeFromIndex(kv: KVNamespace, guildId: string, partyId: string): Promise<void> {
  const index = await getPartyIndex(kv, guildId)
  await savePartyIndex(kv, guildId, index.filter(e => e.id !== partyId))
}

export async function updateIndexEntry(
  kv: KVNamespace,
  guildId: string,
  partyId: string,
  updates: Partial<PartyIndexEntry>,
): Promise<void> {
  const index = await getPartyIndex(kv, guildId)
  const idx = index.findIndex(e => e.id === partyId)
  if (idx === -1) return
  index[idx] = { ...index[idx]!, ...updates }
  await savePartyIndex(kv, guildId, index)
}

export async function getUserPartyId(kv: KVNamespace, guildId: string, userId: string): Promise<string | null> {
  return kv.get(`user:${guildId}:${userId}`)
}

export async function setUserPartyId(kv: KVNamespace, guildId: string, userId: string, partyId: string | null): Promise<void> {
  if (partyId) {
    await kv.put(`user:${guildId}:${userId}`, partyId)
  } else {
    await kv.delete(`user:${guildId}:${userId}`)
  }
}

export async function findParty(kv: KVNamespace, guildId: string, nameOrId: string): Promise<PartyIndexEntry | null> {
  const index = await getPartyIndex(kv, guildId)
  const upper = nameOrId.toUpperCase()
  return index.find(
    p => p.id === upper || p.name.toLowerCase() === nameOrId.toLowerCase()
  ) ?? null
}

export async function findPartyById(kv: KVNamespace, guildId: string, partyId: string): Promise<PartyIndexEntry | null> {
  const index = await getPartyIndex(kv, guildId)
  return index.find(e => e.id === partyId) ?? null
}

// ── User profiles ────────────────────────────────────────────────────────────

export async function getUserProfile(kv: KVNamespace, userId: string): Promise<UserProfile> {
  const raw = await kv.get(`profile:${userId}`)
  return raw ? JSON.parse(raw) as UserProfile : { igns: {} }
}

export async function saveUserIgn(kv: KVNamespace, userId: string, game: string, ign: string): Promise<void> {
  const profile = await getUserProfile(kv, userId)
  profile.igns[game] = ign
  await kv.put(`profile:${userId}`, JSON.stringify(profile))
}

// ── Durable Object routing ───────────────────────────────────────────────────

export function getPartyStub(env: AppBindings, guildId: string, partyId: string): DurableObjectStub {
  const doId = env.PARTY_STATE.idFromName(`party-${guildId}-${partyId}`)
  return env.PARTY_STATE.get(doId)
}

export async function callParty<T>(
  stub: DurableObjectStub,
  action: string,
  body?: unknown,
): Promise<T> {
  const res = await stub.fetch(`http://do/${action}`, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json<{ error: string }>().catch(() => null)
    throw new Error(err?.error ?? `DO request failed (${res.status})`)
  }
  return res.json<T>()
}

// ── Embed sync ───────────────────────────────────────────────────────────────

export async function syncEmbed(token: string, party: PartyData): Promise<void> {
  if (!party.embedMessageId || !party.embedChannelId) return
  await editMessage(token, party.embedChannelId, party.embedMessageId, {
    embeds: [buildPartyEmbed(party)],
    components: buildPartyComponents(party),
  })
}

export async function trySyncEmbed(token: string, party: PartyData): Promise<void> {
  try { await syncEmbed(token, party) } catch (e) {
    // Usually the message was deleted manually; log so persistent failures show up.
    console.warn(`syncEmbed failed for party ${party.id} in guild ${party.guildId}:`, e)
  }
}

export async function postPartyEmbed(
  token: string,
  channelId: string,
  party: PartyData,
): Promise<{ id: string; channel_id: string }> {
  return postMessage(token, channelId, {
    embeds: [buildPartyEmbed(party)],
    components: buildPartyComponents(party),
  })
}

export async function markDisbanded(token: string, party: PartyData, reason?: string): Promise<void> {
  if (!party.embedMessageId || !party.embedChannelId) return
  await editMessage(token, party.embedChannelId, party.embedMessageId, {
    embeds: [buildDisbandedEmbed(party, reason)],
    components: [],
  })
}

// ── Party lifecycle (shared by slash commands and the admin API) ─────────────

export interface CreatePartyOpts {
  guildId: string
  channelId: string  // text channel the embed is posted in
  owner: { id: string; username: string; displayName: string; ign?: string }
  name: string
  description: string
  game: string
  maxSize: number
  voiceChannelId?: string
}

export async function createPartyAndEmbed(
  env: AppBindings,
  opts: CreatePartyOpts,
): Promise<{ ok: true; party: PartyData } | { ok: false; error: string }> {
  const index = await getPartyIndex(env.PARTY_KV, opts.guildId)
  const partyId = uniquePartyId(index)
  const stub = getPartyStub(env, opts.guildId, partyId)

  const party = await callParty<PartyData>(stub, 'create', {
    id: partyId,
    guildId: opts.guildId,
    name: opts.name,
    description: opts.description,
    game: opts.game,
    ownerId: opts.owner.id,
    ownerUsername: opts.owner.username,
    ownerName: opts.owner.displayName,
    ownerIgn: opts.owner.ign,
    maxSize: opts.maxSize,
    voiceChannelId: opts.voiceChannelId,
  })

  // If the embed can't be posted (e.g. missing channel permissions), tear the
  // party back down — otherwise it lingers as an unlisted DO whose cleanup
  // alarm later wipes the owner's user→party mapping.
  let msg: { id: string }
  try {
    msg = await postPartyEmbed(env.DISCORD_BOT_TOKEN, opts.channelId, party)
  } catch (e) {
    console.error('postPartyEmbed failed:', e)
    await callParty(stub, 'forcedisband', {}).catch(() => {})
    return { ok: false, error: "Couldn't post the party message in that channel — check the bot's permissions there." }
  }
  const final = await callParty<PartyData>(stub, 'setmessage', { messageId: msg.id, channelId: opts.channelId })

  await addToIndex(env.PARTY_KV, opts.guildId, { id: partyId, name: party.name, game: party.game })
  await setUserPartyId(env.PARTY_KV, opts.guildId, opts.owner.id, partyId)
  return { ok: true, party: final }
}

/** Delete the old embed (if any) and post a fresh one in the given channel. */
export async function repostPartyEmbed(
  env: AppBindings,
  stub: DurableObjectStub,
  party: PartyData,
  channelId: string,
): Promise<void> {
  if (party.embedMessageId && party.embedChannelId) {
    try { await deleteMessage(env.DISCORD_BOT_TOKEN, party.embedChannelId, party.embedMessageId) } catch { /* already gone */ }
  }
  const msg = await postPartyEmbed(env.DISCORD_BOT_TOKEN, channelId, party)
  await callParty<PartyData>(stub, 'setmessage', { messageId: msg.id, channelId })
}

// ── Misc ─────────────────────────────────────────────────────────────────────

const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function randomId(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  let out = ''
  for (const b of buf) out += ID_ALPHABET[b % ID_ALPHABET.length]
  return out
}

/** Generate a party ID that doesn't collide with any party in the guild index. */
export function uniquePartyId(index: PartyIndexEntry[]): string {
  for (let i = 0; i < 10; i++) {
    const id = randomId()
    if (!index.some(e => e.id === id)) return id
  }
  throw new Error('Could not generate a unique party ID')
}

export function extractMemberInfo(interaction: any): {
  userId: string
  username: string
  displayName: string
} {
  const user = interaction.member?.user ?? interaction.user
  return {
    userId: user.id as string,
    username: user.username as string,
    displayName: (interaction.member?.nick ?? user.global_name ?? user.username) as string,
  }
}

export function isGuildAdmin(interaction: any): boolean {
  const perms = interaction.member?.permissions
  if (!perms) return false
  try {
    return (BigInt(perms) & 0x8n) === 0x8n
  } catch {
    return false
  }
}

export function extractResolvedUser(interaction: any, userId: string): {
  username: string
  displayName: string
} | null {
  const resolved = (interaction.data as any)?.resolved
  const user = resolved?.users?.[userId]
  if (!user) return null
  const member = resolved?.members?.[userId]
  return {
    username: user.username as string,
    displayName: (member?.nick ?? user.global_name ?? user.username) as string,
  }
}
