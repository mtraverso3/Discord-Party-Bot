import type { CommandContext } from 'discord-hono'
import type { AppEnv, PartyData } from '../types'
import {
  addToIndex, callParty, extractMemberInfo, findParty,
  getPartyIndex, getPartyStub, getUserPartyId, getUserProfile,
  markDisbanded, postPartyEmbed, randomId, removeFromIndex,
  saveUserIgn, setUserPartyId, trySyncEmbed,
} from '../lib/party'
import { deleteMessage, sendDM } from '../lib/discord'
import { buildPartyEmbed } from '../lib/embeds'

// ── Helpers ───────────────────────────────────────────────────────────────────

function sub(c: CommandContext<AppEnv>): { name: string; opts: Record<string, any> } {
  const options = (c.interaction.data as any).options as any[]
  const subCmd = options?.[0]
  const opts: Record<string, any> = {}
  for (const o of subCmd?.options ?? []) opts[o.name] = o.value
  return { name: subCmd?.name ?? '', opts }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleParty(c: CommandContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => {
    const { name, opts } = sub(c)
    const guildId = c.interaction.guild_id!
    const channelId = c.interaction.channel_id!
    const { userId, username, displayName } = extractMemberInfo(c.interaction)

    try {
      switch (name) {
        case 'create':  return await create(c, guildId, channelId, userId, username, displayName, opts)
        case 'join':    return await join(c, guildId, userId, username, displayName, opts)
        case 'leave':   return await leave(c, guildId, userId)
        case 'info':    return await info(c, guildId, userId, opts)
        case 'list':    return await list(c, guildId)
        case 'ign':     return await ign(c, guildId, userId, opts)
        case 'close':   return await closeParty(c, guildId, userId)
        case 'open':    return await openParty(c, guildId, userId)
        case 'approve': return await approve(c, guildId, userId, opts)
        case 'deny':    return await deny(c, guildId, userId, opts)
        case 'kick':    return await kick(c, guildId, userId, opts)
        case 'disband': return await disband(c, guildId, userId)
        case 'bump':    return await bump(c, guildId, channelId, userId)
        default:        return await c.followup({ content: 'Unknown subcommand.', flags: 64 })
      }
    } catch (e) {
      console.error('handleParty error:', e)
      return c.followup({ content: 'Something went wrong. Please try again.', flags: 64 })
    }
  })
}

// ── /party create ─────────────────────────────────────────────────────────────

async function create(
  c: CommandContext<AppEnv>,
  guildId: string,
  channelId: string,
  userId: string,
  username: string,
  displayName: string,
  opts: Record<string, any>,
) {
  const [existingPartyId, index, profile] = await Promise.all([
    getUserPartyId(c.env.PARTY_KV, guildId, userId),
    getPartyIndex(c.env.PARTY_KV, guildId),
    getUserProfile(c.env.PARTY_KV, userId),
  ])

  if (existingPartyId) {
    return c.followup({ content: `You're already in party \`${existingPartyId}\`. Leave it or disband it first.`, flags: 64 })
  }
  if (index.length >= 10) {
    return c.followup({ content: 'There are already 10 active parties. Wait for one to disband.', flags: 64 })
  }

  const game = opts['game'] ?? 'Other'
  const partyId = randomId()
  const stub = getPartyStub(c.env, guildId, partyId)

  const party = await callParty<PartyData>(stub, 'create', {
    id: partyId,
    guildId,
    name: opts['name'],
    description: opts['description'] ?? '',
    game,
    ownerId: userId,
    ownerUsername: username,
    ownerName: displayName,
    ownerIgn: profile.igns[game],
    maxSize: opts['cap'],
    voiceChannelId: opts['voice-channel'],
  })

  const msg = await postPartyEmbed(c.env.DISCORD_BOT_TOKEN, channelId, party)
  await callParty<PartyData>(stub, 'setmessage', { messageId: msg.id, channelId })

  await addToIndex(c.env.PARTY_KV, guildId, { id: partyId, name: party.name, game: party.game })
  await setUserPartyId(c.env.PARTY_KV, guildId, userId, partyId)

  return c.followup({ content: `Party **${party.name}** created! (ID: \`${partyId}\`)`, flags: 64 })
}

// ── /party join ───────────────────────────────────────────────────────────────

async function join(
  c: CommandContext<AppEnv>,
  guildId: string,
  userId: string,
  username: string,
  displayName: string,
  opts: Record<string, any>,
) {
  const [currentPartyId, entry, profile] = await Promise.all([
    getUserPartyId(c.env.PARTY_KV, guildId, userId),
    findParty(c.env.PARTY_KV, guildId, opts['party'] as string),
    getUserProfile(c.env.PARTY_KV, userId),
  ])

  if (currentPartyId) {
    return c.followup({ content: `You're already in party \`${currentPartyId}\`. Leave it first.`, flags: 64 })
  }
  if (!entry) {
    return c.followup({ content: 'Party not found. Use `/party list` to see active parties.', flags: 64 })
  }

  const stub = getPartyStub(c.env, guildId, entry.id)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'join', {
    userId, username, displayName, ign: profile.igns[entry.game],
  })

  if (result.status === 'already_member') return c.followup({ content: "You're already in that party.", flags: 64 })
  if (result.status === 'already_queued') return c.followup({ content: "You're already queued for that party.", flags: 64 })

  await setUserPartyId(c.env.PARTY_KV, guildId, userId, entry.id)
  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

  const msg = result.status === 'joined'
    ? `You joined **${result.data.name}**!`
    : `**${result.data.name}** is ${result.data.isClosed ? 'closed' : 'full'} — you're in the queue at position ${result.data.queue.length}.`

  return c.followup({ content: msg, flags: 64 })
}

// ── /party leave ──────────────────────────────────────────────────────────────

async function leave(c: CommandContext<AppEnv>, guildId: string, userId: string) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
  if (!partyId) return c.followup({ content: "You're not in any party.", flags: 64 })

  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData; promoted?: string }>(stub, 'leave', { userId })

  if (result.status === 'is_owner') {
    return c.followup({ content: "You're the party owner — use `/party disband` to end it.", flags: 64 })
  }
  if (result.status === 'not_in') return c.followup({ content: "You're not in that party.", flags: 64 })

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
}

// ── /party info ───────────────────────────────────────────────────────────────

async function info(c: CommandContext<AppEnv>, guildId: string, userId: string, opts: Record<string, any>) {
  let partyId = opts['party'] as string | undefined
  if (!partyId) {
    const kv = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
    if (!kv) return c.followup({ content: "You're not in a party. Use `/party list` to browse, or pass a party name/ID.", flags: 64 })
    partyId = kv
  } else {
    const entry = await findParty(c.env.PARTY_KV, guildId, partyId)
    if (!entry) return c.followup({ content: 'Party not found. Use `/party list` to see active parties.', flags: 64 })
    partyId = entry.id
  }

  const stub = getPartyStub(c.env, guildId, partyId)
  const party = await callParty<PartyData | null>(stub, 'get')
  if (!party) return c.followup({ content: 'Party not found.', flags: 64 })

  return c.followup({ embeds: [buildPartyEmbed(party)], flags: 64 })
}

// ── /party list ───────────────────────────────────────────────────────────────

async function list(c: CommandContext<AppEnv>, guildId: string) {
  const index = await getPartyIndex(c.env.PARTY_KV, guildId)
  if (index.length === 0) {
    return c.followup({ content: 'No active parties. Create one with `/party create`!', flags: 64 })
  }

  const lines = await Promise.all(
    index.map(async (entry: { id: string; name: string; game: string }) => {
      const stub = getPartyStub(c.env, guildId, entry.id)
      const party = await callParty<PartyData | null>(stub, 'get').catch(() => null)
      if (!party) return null
      const status = party.isClosed ? '🔒' : party.members.length >= party.maxSize ? '🟡' : '🟢'
      const queueNote = party.queue.length > 0 ? ` *(${party.queue.length} queued)*` : ''
      return `${status} **${party.name}** \`${party.id}\` — ${party.game} — ${party.members.length}/${party.maxSize}${queueNote}`
    }),
  )

  const valid = lines.filter(Boolean).join('\n')
  return c.followup({
    embeds: [{
      title: 'Active Parties',
      description: valid || 'No parties found.',
      color: 0x5865f2,
      footer: { text: 'Use /party join <name or ID> to join · 🟢 open · 🟡 full · 🔒 closed' },
    }],
    flags: 64,
  })
}

// ── /party ign ────────────────────────────────────────────────────────────────

async function ign(c: CommandContext<AppEnv>, guildId: string, userId: string, opts: Record<string, any>) {
  const game = opts['game'] as string
  const ignValue = opts['name'] as string

  const [partyId] = await Promise.all([
    getUserPartyId(c.env.PARTY_KV, guildId, userId),
    saveUserIgn(c.env.PARTY_KV, userId, game, ignValue),
  ])

  if (partyId) {
    const index = await getPartyIndex(c.env.PARTY_KV, guildId)
    const currentEntry = index.find(e => e.id === partyId)
    if (currentEntry && currentEntry.game === game) {
      const stub = getPartyStub(c.env, guildId, partyId)
      const result = await callParty<{ status: string; data: PartyData }>(stub, 'setign', { userId, ign: ignValue })
      if (result.status === 'updated') await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)
    }
  }

  return c.followup({ content: `IGN for **${game}** set to **${ignValue}**.`, flags: 64 })
}

// ── /party close ──────────────────────────────────────────────────────────────

async function closeParty(c: CommandContext<AppEnv>, guildId: string, userId: string) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'close', { requesterId: userId })

  if (result.status === 'unauthorized')    return c.followup({ content: 'Only the party owner can close the party.', flags: 64 })
  if (result.status === 'already_closed') return c.followup({ content: 'The party is already closed.', flags: 64 })

  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)
  return c.followup({ content: 'Party closed. New joiners will be added to the queue.', flags: 64 })
}

// ── /party open ───────────────────────────────────────────────────────────────

async function openParty(c: CommandContext<AppEnv>, guildId: string, userId: string) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData; promoted: string[] }>(stub, 'open', { requesterId: userId })

  if (result.status === 'unauthorized')  return c.followup({ content: 'Only the party owner can open the party.', flags: 64 })
  if (result.status === 'already_open') return c.followup({ content: 'The party is already open.', flags: 64 })

  await Promise.all(result.promoted.map(async (uid) => {
    await setUserPartyId(c.env.PARTY_KV, guildId, uid, partyId)
    await sendDM(c.env.DISCORD_BOT_TOKEN, uid, `You've been moved from the queue into **${result.data.name}**! Head to the voice channel and get ready.`)
  }))

  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

  const promotedNote = result.promoted.length > 0
    ? ` ${result.promoted.length} player(s) auto-promoted from queue.`
    : ''
  return c.followup({ content: `Party opened!${promotedNote}`, flags: 64 })
}

// ── /party approve ────────────────────────────────────────────────────────────

async function approve(c: CommandContext<AppEnv>, guildId: string, requesterId: string, opts: Record<string, any>) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, requesterId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const targetId = opts['user'] as string
  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'approve', { requesterId, userId: targetId })

  if (result.status === 'unauthorized') return c.followup({ content: 'Only the party owner can approve members.', flags: 64 })
  if (result.status === 'not_queued')   return c.followup({ content: 'That user is not in the queue.', flags: 64 })
  if (result.status === 'full')         return c.followup({ content: "The party is full.", flags: 64 })

  await setUserPartyId(c.env.PARTY_KV, guildId, targetId, partyId)
  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)
  await sendDM(c.env.DISCORD_BOT_TOKEN, targetId, `You've been approved into **${result.data.name}**! Head to the voice channel and get ready.`)

  return c.followup({ content: `<@${targetId}> approved into the party.`, flags: 64 })
}

// ── /party deny ───────────────────────────────────────────────────────────────

async function deny(c: CommandContext<AppEnv>, guildId: string, requesterId: string, opts: Record<string, any>) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, requesterId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const targetId = opts['user'] as string
  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'deny', { requesterId, userId: targetId })

  if (result.status === 'unauthorized') return c.followup({ content: 'Only the party owner can deny members.', flags: 64 })
  if (result.status === 'not_queued')   return c.followup({ content: 'That user is not in the queue.', flags: 64 })

  await setUserPartyId(c.env.PARTY_KV, guildId, targetId, null)
  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)
  await sendDM(c.env.DISCORD_BOT_TOKEN, targetId, `Your request to join **${result.data.name}** was denied.`)

  return c.followup({ content: `<@${targetId}> removed from the queue.`, flags: 64 })
}

// ── /party kick ───────────────────────────────────────────────────────────────

async function kick(c: CommandContext<AppEnv>, guildId: string, requesterId: string, opts: Record<string, any>) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, requesterId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const targetId = opts['user'] as string
  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData; promoted?: string }>(stub, 'kick', { requesterId, userId: targetId })

  if (result.status === 'unauthorized') return c.followup({ content: 'Only the party owner can kick members.', flags: 64 })
  if (result.status === 'is_owner')     return c.followup({ content: "You can't kick yourself. Use `/party disband` to end the party.", flags: 64 })
  if (result.status === 'not_in')       return c.followup({ content: 'That user is not in the party.', flags: 64 })

  await setUserPartyId(c.env.PARTY_KV, guildId, targetId, null)
  await sendDM(c.env.DISCORD_BOT_TOKEN, targetId, `You were removed from **${result.data.name}**.`)

  if (result.promoted) {
    await setUserPartyId(c.env.PARTY_KV, guildId, result.promoted, partyId)
    await sendDM(c.env.DISCORD_BOT_TOKEN, result.promoted, `You've been moved from the queue into **${result.data.name}**! Head to the voice channel and get ready.`)
  }

  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)
  return c.followup({ content: `<@${targetId}> removed from the party.${result.promoted ? ` <@${result.promoted}> promoted from queue.` : ''}`, flags: 64 })
}

// ── /party bump ───────────────────────────────────────────────────────────────

async function bump(c: CommandContext<AppEnv>, guildId: string, channelId: string, userId: string) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const stub = getPartyStub(c.env, guildId, partyId)
  const party = await callParty<PartyData | null>(stub, 'get')
  if (!party) return c.followup({ content: 'Party not found.', flags: 64 })
  if (party.ownerId !== userId) return c.followup({ content: 'Only the party owner can bump the party.', flags: 64 })

  if (party.embedMessageId && party.embedChannelId) {
    try { await deleteMessage(c.env.DISCORD_BOT_TOKEN, party.embedChannelId, party.embedMessageId) } catch { /* already gone */ }
  }

  const msg = await postPartyEmbed(c.env.DISCORD_BOT_TOKEN, channelId, party)
  await callParty<PartyData>(stub, 'setmessage', { messageId: msg.id, channelId })

  return c.followup({ content: 'Party bumped!', flags: 64 })
}

// ── /party disband ────────────────────────────────────────────────────────────

async function disband(c: CommandContext<AppEnv>, guildId: string, userId: string) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'disband', { requesterId: userId })

  if (result.status === 'unauthorized') return c.followup({ content: 'Only the party owner can disband the party.', flags: 64 })

  const notifyIds = [
    ...result.data.members.filter(m => m.userId !== userId).map(m => m.userId),
    ...result.data.queue.map(q => q.userId),
  ]
  await Promise.all([
    ...notifyIds.map(uid => sendDM(c.env.DISCORD_BOT_TOKEN, uid, `**${result.data.name}** has been disbanded by the owner.`)),
    ...result.data.members.map(m => setUserPartyId(c.env.PARTY_KV, guildId, m.userId, null)),
    ...result.data.queue.map(q => setUserPartyId(c.env.PARTY_KV, guildId, q.userId, null)),
    removeFromIndex(c.env.PARTY_KV, guildId, partyId),
    markDisbanded(c.env.DISCORD_BOT_TOKEN, result.data),
  ])

  return c.followup({ content: `**${result.data.name}** has been disbanded.`, flags: 64 })
}
