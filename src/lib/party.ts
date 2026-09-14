import { rulesAccess } from './rules'
import type { AppBindings, PartyData } from '../types'
import { claimEmbedRepost, createParty, disbandParty, getParty, setEmbedMessage } from '../store/parties'
import { getRulesGate } from '../store/rules'
import { randomId } from './id'
import { deleteMessage, editMessage, getChannelMessages, postMessage } from './discord'
import { buildDisbandedEmbed, buildPartyComponents, buildPartyEmbed, isPartyEmbedMessage } from './embeds'

// Orchestration that spans the store and the Discord API: posting/refreshing
// party embeds and the create-party flow.

// ── Embed sync ───────────────────────────────────────────────────────────────

/**
 * Whether this party's rules check is live. Only asked when the party wants
 * one, so an ordinary party costs no extra query.
 */
async function rulesEnforced(env: AppBindings, party: PartyData): Promise<boolean> {
  if (!party.rulesRequired) return false
  return !!(await getRulesGate(env.DB, party.guildId))?.enabled
}

export async function syncEmbed(env: AppBindings, party: PartyData): Promise<void> {
  if (!party.embedMessageId || !party.embedChannelId) return
  await editMessage(env.DISCORD_BOT_TOKEN, party.embedChannelId, party.embedMessageId, {
    embeds: [buildPartyEmbed(party, await rulesEnforced(env, party))],
    components: buildPartyComponents(party),
  })
}

export async function trySyncEmbed(env: AppBindings, party: PartyData | undefined): Promise<void> {
  if (!party) return
  try { await syncEmbed(env, party) } catch (e) {
    // Usually the message was deleted manually; log so persistent failures show up.
    console.warn(`syncEmbed failed for party ${party.id} in guild ${party.guildId}:`, e)
  }
}

export async function postPartyEmbed(
  env: AppBindings,
  channelId: string,
  party: PartyData,
): Promise<{ id: string; channel_id: string }> {
  return postMessage(env.DISCORD_BOT_TOKEN, channelId, {
    embeds: [buildPartyEmbed(party, await rulesEnforced(env, party))],
    components: buildPartyComponents(party),
  })
}

/**
 * Grey out the party's message(s) in the channel. Returns how many were
 * updated — 0 means the party still looks live on screen, which the caller
 * should say out loud rather than reporting a clean disband.
 *
 * The message the database points at is only the one we know about: a bump
 * that raced before the embed claim existed could leave duplicates behind, and
 * the pointer names whichever of them was recorded last — not necessarily the
 * one at the bottom of the channel. If the pointer was lost mid-bump there may
 * be no tracked message at all. So the channel is also scanned for anything
 * carrying this party's embed, and every match is tombstoned; otherwise a
 * disbanded party keeps advertising itself with live buttons.
 *
 * Never throws: a disband has already happened by the time this runs.
 */
export async function tryMarkDisbanded(env: AppBindings, party: PartyData, reason?: string): Promise<number> {
  const channelId = party.embedChannelId
  if (!channelId) return 0
  const body = { embeds: [buildDisbandedEmbed(party, reason)], components: [] }

  const targets = party.embedMessageId ? [party.embedMessageId] : []
  // Untracked copies are best-effort — a channel we can't read must not stop
  // the tracked message from being greyed out.
  try {
    const found = await findPartyEmbedMessages(env, party, channelId)
    for (const id of found) if (!targets.includes(id)) targets.push(id)
  } catch (e) {
    console.warn(`embed scan failed for party ${party.id} in guild ${party.guildId}:`, e)
  }

  let updated = 0
  for (const id of targets.slice(0, DISBAND_EDIT_LIMIT)) {
    try {
      await editMessage(env.DISCORD_BOT_TOKEN, channelId, id, body)
      updated++
    } catch (e) {
      console.warn(`markDisbanded failed for message ${id} of party ${party.id} in guild ${party.guildId}:`, e)
    }
  }
  return updated
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
  rulesRequired?: boolean
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
      rulesRequired: opts.rulesRequired,
    }, rulesAccess(env))
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
    msg = await postPartyEmbed(env, opts.channelId, party)
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
// Untracked copies a disband will grey out in one pass.
const DISBAND_EDIT_LIMIT = 10

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
    msg = await postPartyEmbed(env, channelId, fresh)
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
 * Every message in `channelId` that is one of this bot's embeds for this run
 * of the party — the database pointer plus any untracked copy. Throws when the
 * channel can't be read (no Read Message History), so callers decide whether
 * that's fatal.
 */
async function findPartyEmbedMessages(
  env: AppBindings,
  party: PartyData,
  channelId: string,
): Promise<string[]> {
  const messages = await getChannelMessages(env.DISCORD_BOT_TOKEN, channelId, STALE_SCAN_LIMIT)
  return messages
    .filter(m => m.author?.id === env.DISCORD_APPLICATION_ID && isPartyEmbedMessage(m, party))
    .map(m => m.id)
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
    const stale = (await findPartyEmbedMessages(env, party, channelId))
      .filter(id => id !== keepMessageId && BigInt(id) < keep)
      .slice(0, STALE_DELETE_LIMIT)
    for (const id of stale) {
      try { await deleteMessage(env.DISCORD_BOT_TOKEN, channelId, id) } catch { /* try the rest */ }
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

/**
 * Whether the caller may moderate the rules check. Discord ignores
 * default_member_permissions on subcommands, so this is enforced here rather
 * than declared in the command definition.
 */
export function canModerateRules(interaction: any): boolean {
  const perms = interaction.member?.permissions
  if (!perms) return false
  try {
    const bits = BigInt(perms)
    return (bits & 0x10000000n) === 0x10000000n   // Manage Roles
      || (bits & 0x8n) === 0x8n                   // Administrator implies it
  } catch {
    return false
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
