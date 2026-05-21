import type { AppBindings, PartyData, PartyIndexEntry, UserProfile } from '../types'
import { editMessage, postMessage } from './discord'
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
    const err = await res.json<{ error: string }>()
    throw new Error(err.error ?? 'Unknown DO error')
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
  try { await syncEmbed(token, party) } catch { /* message may have been deleted */ }
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

// ── Misc ─────────────────────────────────────────────────────────────────────

export function randomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
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
