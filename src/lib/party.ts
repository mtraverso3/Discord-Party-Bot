import type { AppBindings, PartyData } from '../types'
import { claimEmbedRepost, createParty, disbandParty, getParty, setEmbedMessage } from '../store/parties'
import { randomId } from './id'
import { deleteMessage, editMessage, getChannelMessages, postMessage } from './discord'
import { buildDisbandedEmbed, buildPartyComponents, buildPartyEmbed, isPartyEmbedMessage } from './embeds'

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

// How far back a bump looks for duplicate embeds to clean up, and how many it
// will delete in one pass — both bounded so a bump stays a handful of calls.
const STALE_SCAN_LIMIT = 50
const STALE_DELETE_LIMIT = 10

export type RepostResult =
  | 'reposted'    // this call posted the new embed
  | 'superseded'  // someone else's concurrent bump won; nothing was posted

/**
 * Move the party's embed to the bottom of the channel: post a fresh one and
 * delete the old one.
 *
 * Concurrent bumps used to each post their own embed and then race to record
 * it, leaving every loser's message orphaned in the channel forever. The
 * repost is now claimed in the database *before* anything is posted, so only
 * one caller of a concurrent set posts at all; the rest get 'superseded'.
 */
export async function repostPartyEmbed(
  env: AppBindings,
  party: PartyData,
  channelId: string,
): Promise<RepostResult> {
  const previousId = party.embedMessageId
  const previousChannelId = party.embedChannelId

  if (previousId) {
    const claimed = await claimEmbedRepost(env.DB, party.guildId, party.id, previousId)
    if (!claimed) return 'superseded'
  }

  // Re-read: the caller's snapshot may predate a join that landed while we
  // were claiming, and the new embed should show the party as it is now.
  const fresh = await getParty(env.DB, party.guildId, party.id) ?? party

  let msg: { id: string }
  try {
    msg = await postPartyEmbed(env.DISCORD_BOT_TOKEN, channelId, fresh)
  } catch (e) {
    // Nothing was posted and the old message is still there — hand the
    // pointer back so the party doesn't end up with no embed at all.
    if (previousId && previousChannelId) {
      await setEmbedMessage(env.DB, party.guildId, party.id, previousId, previousChannelId).catch(() => {})
    }
    throw e
  }

  await setEmbedMessage(env.DB, party.guildId, party.id, msg.id, channelId)

  if (previousId && previousChannelId) {
    try { await deleteMessage(env.DISCORD_BOT_TOKEN, previousChannelId, previousId) } catch { /* already gone */ }
  }
  await deleteStalePartyEmbeds(env, fresh, channelId, msg.id)
  return 'reposted'
}

/**
 * Failsafe: delete this party's older embeds left in the channel — duplicates
 * from a bump that raced before the claim existed, or an old message whose
 * delete failed. A message has to clear every check to go:
 *   * posted by this bot,
 *   * carries this party's ID (see isPartyEmbedMessage),
 *   * belongs to this run of that ID, not an earlier party that reused it,
 *   * older than the embed we just posted — so two sweeps can never delete
 *     each other's message and leave the party with none.
 * Cleanup never fails a bump: the embed is already posted by this point.
 */
async function deleteStalePartyEmbeds(
  env: AppBindings,
  party: PartyData,
  channelId: string,
  keepMessageId: string,
): Promise<void> {
  try {
    const keep = BigInt(keepMessageId)
    const messages = await getChannelMessages(env.DISCORD_BOT_TOKEN, channelId, STALE_SCAN_LIMIT)
    const stale = messages
      .filter(m =>
        m.id !== keepMessageId
        && m.author?.id === env.DISCORD_APPLICATION_ID
        && isPartyEmbedMessage(m, party)
        && BigInt(m.id) < keep)
      .slice(0, STALE_DELETE_LIMIT)
    for (const m of stale) {
      await deleteMessage(env.DISCORD_BOT_TOKEN, channelId, m.id)
    }
    if (stale.length > 0) {
      console.warn(`cleaned up ${stale.length} duplicate embed(s) for party ${party.id} in guild ${party.guildId}`)
    }
  } catch (e) {
    console.warn(`duplicate-embed cleanup failed for party ${party.id} in guild ${party.guildId}:`, e)
  }
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
