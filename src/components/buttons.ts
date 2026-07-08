import type { ComponentContext } from 'discord-hono'
import type { AppEnv } from '../types'
import { extractMemberInfo, trySyncEmbed } from '../lib/party'
import * as parties from '../store/parties'
import { getUserIgn } from '../store/profiles'
import { HELP_PAGES, buildHelpComponents, buildHelpEmbed } from '../lib/embeds'

// ── Help paging (help_page;<n>) ───────────────────────────────────────────────

export async function handleHelpPage(c: ComponentContext<AppEnv>) {
  const raw = parseInt((c.interaction.data as any).custom_id as string, 10)
  const page = Math.min(Math.max(raw || 1, 1), HELP_PAGES)
  return c.resUpdate({
    embeds: [buildHelpEmbed(page)],
    components: buildHelpComponents(page),
  })
}

// ── Join / Join Queue buttons (party_join;<id>, party_queue;<id>) ─────────────
// One handler: both buttons attempt a join, and the store decides member vs
// queue atomically based on capacity and closed state at insert time.

async function joinViaButton(c: ComponentContext<AppEnv>, fromQueueButton: boolean) {
  const partyId = (c.interaction.data as any).custom_id as string
  const guildId = c.interaction.guild_id!
  const { userId, username, displayName } = extractMemberInfo(c.interaction)

  try {
    const currentParty = await parties.getUserPartyId(c.env.DB, guildId, userId)
    if (currentParty && currentParty !== partyId) {
      return c.followup({ content: `You're in party \`${currentParty}\`. Leave it first.`, flags: 64 })
    }

    const party = await parties.getParty(c.env.DB, guildId, partyId)
    if (!party) return c.followup({ content: 'This party no longer exists.', flags: 64 })

    const ign = await getUserIgn(c.env.DB, userId, party.game)
    const result = await parties.joinParty(c.env.DB, guildId, partyId, { userId, username, displayName, ign })

    if (result.status === 'not_found')      return c.followup({ content: 'This party no longer exists.', flags: 64 })
    if (result.status === 'in_other_party') return c.followup({ content: "You're already in another party. Leave it first.", flags: 64 })
    if (result.status === 'already_member') return c.followup({ content: "You're already in this party.", flags: 64 })
    if (result.status === 'already_queued') return c.followup({ content: "You're already in the queue for this party.", flags: 64 })

    await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

    const data = result.data!
    if (result.status === 'joined') {
      return c.followup({
        content: fromQueueButton
          ? `A spot was open — you joined **${data.name}** directly!`
          : `You joined **${data.name}**!`,
        flags: 64,
      })
    }
    const pos = data.queue.findIndex(q => q.userId === userId) + 1
    return c.followup({
      content: fromQueueButton
        ? `You're in the queue for **${data.name}** at position ${pos}.`
        : `**${data.name}** is ${data.isClosed ? 'closed' : 'full'} — you're in the queue at position ${pos}.`,
      flags: 64,
    })
  } catch (e) {
    console.error(`party button error (party ${partyId}):`, e)
    return c.followup({ content: 'Something went wrong. Please try again.', flags: 64 })
  }
}

export async function handleJoinButton(c: ComponentContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => joinViaButton(c, false))
}

export async function handleQueueButton(c: ComponentContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => joinViaButton(c, true))
}

// ── BRB button (party_away;<partyId>) ─────────────────────────────────────────

export async function handleAwayButton(c: ComponentContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => {
    const partyId = (c.interaction.data as any).custom_id as string
    const guildId = c.interaction.guild_id!
    const { userId } = extractMemberInfo(c.interaction)

    try {
      const result = await parties.toggleAway(c.env.DB, guildId, partyId, userId)

      if (result.status === 'not_found') return c.followup({ content: 'This party no longer exists.', flags: 64 })
      if (result.status === 'not_in') {
        return c.followup({ content: 'Only party members can set a BRB marker — join first.', flags: 64 })
      }

      await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

      const msg = result.away
        ? "You're marked as away 💤 — click **💤 BRB** again when you're back."
        : "Welcome back! Your away marker is cleared."
      return c.followup({ content: msg, flags: 64 })
    } catch (e) {
      console.error(`party button error (party ${partyId}):`, e)
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
      const result = await parties.leaveParty(c.env.DB, guildId, partyId, userId)

      if (result.status === 'not_found') return c.followup({ content: 'This party no longer exists.', flags: 64 })
      if (result.status === 'is_owner') {
        return c.followup({ content: "You're the party owner — use `/party disband` to end it.", flags: 64 })
      }
      if (result.status === 'not_in') {
        return c.followup({ content: "You're not in this party.", flags: 64 })
      }

      await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

      const msg = result.status === 'left'
        ? `You left **${result.data!.name}**.`
        : `You left the queue for **${result.data!.name}**.`
      return c.followup({ content: msg, flags: 64 })
    } catch (e) {
      console.error(`party button error (party ${partyId}):`, e)
      return c.followup({ content: 'Something went wrong. Please try again.', flags: 64 })
    }
  })
}
