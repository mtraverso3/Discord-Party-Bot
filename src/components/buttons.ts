import type { ComponentContext } from 'discord-hono'
import type { AppEnv, PartyData } from '../types'
import {
  callParty, extractMemberInfo, findPartyById, getPartyStub,
  getUserPartyId, getUserProfile, setUserPartyId, trySyncEmbed,
} from '../lib/party'
import { sendDM } from '../lib/discord'

// ── Join button (party_join;<partyId>) ────────────────────────────────────────

export async function handleJoinButton(c: ComponentContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => {
    const partyId = (c.interaction.data as any).custom_id as string
    const guildId = c.interaction.guild_id!
    const { userId, username, displayName } = extractMemberInfo(c.interaction)

    try {
      const currentParty = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
      if (currentParty) {
        return c.followup({
          content: currentParty === partyId
            ? "You're already in this party."
            : `You're in party \`${currentParty}\`. Leave it first.`,
          flags: 64,
        })
      }

      const [indexEntry, profile] = await Promise.all([
        findPartyById(c.env.PARTY_KV, guildId, partyId),
        getUserProfile(c.env.PARTY_KV, userId),
      ])

      const stub = getPartyStub(c.env, guildId, partyId)
      const ign = indexEntry ? profile.igns[indexEntry.game] : undefined
      const result = await callParty<{ status: string; data: PartyData }>(stub, 'join', { userId, username, displayName, ign }).catch(() => null)

      if (!result) return c.followup({ content: "This party no longer exists.", flags: 64 })
      if (result.status === 'already_member') return c.followup({ content: "You're already in this party.", flags: 64 })
      if (result.status === 'already_queued') return c.followup({ content: "You're already in the queue for this party.", flags: 64 })

      await setUserPartyId(c.env.PARTY_KV, guildId, userId, partyId)
      await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

      const msg = result.status === 'joined'
        ? `You joined **${result.data.name}**!`
        : `**${result.data.name}** is ${result.data.isClosed ? 'closed' : 'full'} — you're in the queue at position ${result.data.queue.length}.`
      return c.followup({ content: msg, flags: 64 })
    } catch {
      return c.followup({ content: 'Something went wrong. Please try again.', flags: 64 })
    }
  })
}

// ── Join Queue button (party_queue;<partyId>) ─────────────────────────────────

export async function handleQueueButton(c: ComponentContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => {
    const partyId = (c.interaction.data as any).custom_id as string
    const guildId = c.interaction.guild_id!
    const { userId, username, displayName } = extractMemberInfo(c.interaction)

    try {
      const currentParty = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
      if (currentParty) {
        return c.followup({
          content: currentParty === partyId
            ? "You're already in this party or queue."
            : `You're in party \`${currentParty}\`. Leave it first.`,
          flags: 64,
        })
      }

      const [indexEntry, profile] = await Promise.all([
        findPartyById(c.env.PARTY_KV, guildId, partyId),
        getUserProfile(c.env.PARTY_KV, userId),
      ])

      const stub = getPartyStub(c.env, guildId, partyId)
      const ign = indexEntry ? profile.igns[indexEntry.game] : undefined
      const result = await callParty<{ status: string; data: PartyData }>(stub, 'join', { userId, username, displayName, ign }).catch(() => null)

      if (!result) return c.followup({ content: "This party no longer exists.", flags: 64 })
      if (result.status === 'already_member') return c.followup({ content: "You're already in this party.", flags: 64 })
      if (result.status === 'already_queued') return c.followup({ content: "You're already in the queue for this party.", flags: 64 })

      await setUserPartyId(c.env.PARTY_KV, guildId, userId, partyId)
      await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

      const pos = result.data.queue.findIndex(q => q.userId === userId) + 1
      const msg = result.status === 'joined'
        ? `A spot was open — you joined **${result.data.name}** directly!`
        : `You're in the queue for **${result.data.name}** at position ${pos}.`
      return c.followup({ content: msg, flags: 64 })
    } catch {
      return c.followup({ content: 'Something went wrong. Please try again.', flags: 64 })
    }
  })
}

// ── Leave button (party_leave;<partyId>) ──────────────────────────────────────

export async function handleLeaveButton(c: ComponentContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => {
    const partyId = (c.interaction.data as any).custom_id as string
    const guildId = c.interaction.guild_id!
    const { userId } = extractMemberInfo(c.interaction)

    try {
      const currentParty = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
      if (!currentParty || currentParty !== partyId) {
        return c.followup({ content: "You're not in this party.", flags: 64 })
      }

      const stub = getPartyStub(c.env, guildId, partyId)
      const result = await callParty<{ status: string; data: PartyData; promoted?: string }>(stub, 'leave', { userId }).catch(() => null)

      if (!result) return c.followup({ content: "This party no longer exists.", flags: 64 })

      if (result.status === 'is_owner') {
        return c.followup({ content: "You're the party owner — use `/party disband` to end it.", flags: 64 })
      }
      if (result.status === 'not_in') {
        return c.followup({ content: "You're not in this party.", flags: 64 })
      }

      await setUserPartyId(c.env.PARTY_KV, guildId, userId, null)
      await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

      if (result.promoted) {
        await setUserPartyId(c.env.PARTY_KV, guildId, result.promoted, partyId)
        await sendDM(c.env.DISCORD_BOT_TOKEN, result.promoted, `You've been moved from the queue into **${result.data.name}**! Head to the voice channel and get ready.`)
      }

      if (result.data.isClosed && result.status === 'left' && !result.promoted && result.data.queue.length > 0) {
        await sendDM(
          c.env.DISCORD_BOT_TOKEN,
          result.data.ownerId,
          `A spot opened in **${result.data.name}** (${result.data.members.length}/${result.data.maxSize}). ${result.data.queue.length} player(s) in queue — use \`/party approve @user\` to let someone in.`,
        )
      }

      const msg = result.status === 'left'
        ? `You left **${result.data.name}**.`
        : `You left the queue for **${result.data.name}**.`
      return c.followup({ content: msg, flags: 64 })
    } catch {
      return c.followup({ content: 'Something went wrong. Please try again.', flags: 64 })
    }
  })
}
