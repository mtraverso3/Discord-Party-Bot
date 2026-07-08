import type { AppBindings, PartyData } from '../types'
import { createParty, disbandParty, setEmbedMessage } from '../store/parties'
import { randomId } from './id'
import { deleteMessage, editMessage, postMessage } from './discord'
import { buildDisbandedEmbed, buildPartyComponents, buildPartyEmbed } from './embeds'

// Orchestration that spans the store and the Discord API: posting/refreshing
// party embeds and the create-party flow.

// ── Embed sync ───────────────────────────────────────────────────────────────

export async function syncEmbed(token: string, party: PartyData): Promise<void> {
  if (!party.embedMessageId || !party.embedChannelId) return
  await editMessage(token, party.embedChannelId, party.embedMessageId, {
    embeds: [buildPartyEmbed(party)],
    components: buildPartyComponents(party),
  })
}

export async function trySyncEmbed(token: string, party: PartyData | undefined): Promise<void> {
  if (!party) return
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

export async function tryMarkDisbanded(token: string, party: PartyData, reason?: string): Promise<void> {
  try { await markDisbanded(token, party, reason) } catch (e) {
    console.warn(`markDisbanded failed for party ${party.id} in guild ${party.guildId}:`, e)
  }
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
  // The store enforces the real invariants atomically: the party_members
  // primary key rejects an owner who's already in a party (even against a
  // concurrent create), and an ID collision rolls the whole insert back.
  let created: Awaited<ReturnType<typeof createParty>> | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    created = await createParty(env.DB, {
      id: randomId(),
      guildId: opts.guildId,
      name: opts.name,
      description: opts.description,
      game: opts.game,
      owner: {
        userId: opts.owner.id,
        username: opts.owner.username,
        displayName: opts.owner.displayName,
        ign: opts.owner.ign,
      },
      maxSize: opts.maxSize,
      voiceChannelId: opts.voiceChannelId,
    })
    if (created.ok || created.error !== 'id_taken') break
  }
  if (!created || !created.ok) {
    if (created && created.error === 'owner_in_party') {
      return { ok: false, error: 'Owner is already in a party.' }
    }
    return { ok: false, error: created?.message ?? 'Could not create the party.' }
  }
  const party = created.party

  // If the embed can't be posted (e.g. missing channel permissions), tear the
  // party back down — otherwise it lingers until the inactivity sweep.
  let msg: { id: string }
  try {
    msg = await postPartyEmbed(env.DISCORD_BOT_TOKEN, opts.channelId, party)
  } catch (e) {
    console.error('postPartyEmbed failed:', e)
    await disbandParty(env.DB, opts.guildId, party.id).catch(() => {})
    return { ok: false, error: "Couldn't post the party message in that channel — check the bot's permissions there." }
  }

  const final = await setEmbedMessage(env.DB, opts.guildId, party.id, msg.id, opts.channelId)
  return { ok: true, party: final ?? party }
}

/** Delete the old embed (if any) and post a fresh one in the given channel. */
export async function repostPartyEmbed(
  env: AppBindings,
  party: PartyData,
  channelId: string,
): Promise<void> {
  if (party.embedMessageId && party.embedChannelId) {
    try { await deleteMessage(env.DISCORD_BOT_TOKEN, party.embedChannelId, party.embedMessageId) } catch { /* already gone */ }
  }
  const msg = await postPartyEmbed(env.DISCORD_BOT_TOKEN, channelId, party)
  await setEmbedMessage(env.DB, party.guildId, party.id, msg.id, channelId)
}

// ── Interaction helpers ──────────────────────────────────────────────────────

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
