import { Modal, TextInput, type CommandContext, type ModalContext } from 'discord-hono'
import type { AppEnv, PartyData } from '../types'
import {
  addToIndex, callParty, extractMemberInfo, extractResolvedUser, findParty,
  getPartyIndex, getPartyStub, getUserPartyId, getUserProfile, isGuildAdmin,
  markDisbanded, postPartyEmbed, randomId, removeFromIndex,
  saveUserIgn, setUserPartyId, trySyncEmbed, updateIndexEntry,
} from '../lib/party'
import { deleteMessage } from '../lib/discord'
import { buildHelpComponents, buildHelpEmbed, buildPartyEmbed } from '../lib/embeds'

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
  // Modal responses must be the immediate (non-deferred) reply.
  const peek = sub(c)
  if (peek.name === 'description') {
    return await openDescriptionModal(c)
  }
  if (peek.name === 'banlist') {
    return await openBanlistModal(c)
  }

  return c.ephemeral().resDefer(async (c) => {
    const { name, opts } = sub(c)
    const guildId = c.interaction.guild_id!
    const channelId = c.interaction.channel_id!
    const { userId, username, displayName } = extractMemberInfo(c.interaction)

    try {
      switch (name) {
        case 'help':    return await help(c)
        case 'create':  return await create(c, guildId, channelId, userId, username, displayName, opts)
        case 'join':    return await join(c, guildId, userId, username, displayName, opts)
        case 'leave':   return await leave(c, guildId, userId)
        case 'info':    return await info(c, guildId, userId, opts)
        case 'list':    return await list(c, guildId)
        case 'ign':     return await ign(c, guildId, userId, opts)
        case 'game':    return await changeGame(c, guildId, userId, opts)
        case 'close':   return await closeParty(c, guildId, userId)
        case 'open':    return await openParty(c, guildId, userId)
        case 'adduser': return await addUser(c, guildId, userId, opts)
        case 'approve': return await approve(c, guildId, userId, opts)
        case 'deny':    return await deny(c, guildId, userId, opts)
        case 'remove':  return await removeUserFromParty(c, guildId, userId, opts)
        case 'promote': return await promote(c, guildId, userId, opts)
        case 'size':    return await setSize(c, guildId, userId, opts)
        case 'disband': return await disband(c, guildId, userId)
        case 'clear':   return await clearAll(c, guildId)
        case 'bump':    return await bump(c, guildId, channelId, userId)
        default:        return await c.followup({ content: 'Unknown subcommand.', flags: 64 })
      }
    } catch (e) {
      console.error('handleParty error:', e)
      return c.followup({ content: 'Something went wrong. Please try again.', flags: 64 })
    }
  })
}

// ── /party help ───────────────────────────────────────────────────────────────

async function help(c: CommandContext<AppEnv>) {
  return c.followup({
    embeds: [buildHelpEmbed(1)],
    components: buildHelpComponents(1),
    flags: 64,
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
  const name = (opts['name'] as string | undefined)?.trim() || `${displayName}'s party`
  const partyId = randomId()
  const stub = getPartyStub(c.env, guildId, partyId)

  const party = await callParty<PartyData>(stub, 'create', {
    id: partyId,
    guildId,
    name,
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

// ── /party game ───────────────────────────────────────────────────────────────

async function changeGame(c: CommandContext<AppEnv>, guildId: string, userId: string, opts: Record<string, any>) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const game = opts['game'] as string
  const stub = getPartyStub(c.env, guildId, partyId)
  const party = await callParty<PartyData | null>(stub, 'get')
  if (!party) return c.followup({ content: 'Party not found.', flags: 64 })
  if (party.ownerId !== userId) return c.followup({ content: 'Only the party owner can change the game.', flags: 64 })
  if (party.game === game) return c.followup({ content: `The party is already set to **${game}**.`, flags: 64 })

  // Build IGN map for the new game by fetching every member's and queue entry's profile
  const allUserIds = [...party.members.map(m => m.userId), ...party.queue.map(q => q.userId)]
  const profiles = await Promise.all(allUserIds.map(uid => getUserProfile(c.env.PARTY_KV, uid)))
  const ignMap: Record<string, string> = {}
  allUserIds.forEach((uid, i) => {
    const ign = profiles[i]!.igns[game]
    if (ign) ignMap[uid] = ign
  })

  const result = await callParty<{ status: string; data: PartyData }>(stub, 'setgame', { requesterId: userId, game, ignMap })
  if (result.status === 'unauthorized') return c.followup({ content: 'Only the party owner can change the game.', flags: 64 })

  await updateIndexEntry(c.env.PARTY_KV, guildId, partyId, { game })
  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

  return c.followup({ content: `Game changed to **${game}**.`, flags: 64 })
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

  await Promise.all(result.promoted.map(uid =>
    setUserPartyId(c.env.PARTY_KV, guildId, uid, partyId),
  ))

  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

  const promotedNote = result.promoted.length > 0
    ? ` ${result.promoted.length} player(s) auto-promoted from queue.`
    : ''
  return c.followup({ content: `Party opened!${promotedNote}`, flags: 64 })
}

// ── /party adduser ────────────────────────────────────────────────────────────

async function addUser(c: CommandContext<AppEnv>, guildId: string, requesterId: string, opts: Record<string, any>) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, requesterId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const targetId = opts['user'] as string
  if (targetId === requesterId) return c.followup({ content: "You're already in the party.", flags: 64 })

  const resolved = extractResolvedUser(c.interaction, targetId)
  if (!resolved) return c.followup({ content: "Couldn't resolve that user.", flags: 64 })

  const [targetParty, indexEntry, profile] = await Promise.all([
    getUserPartyId(c.env.PARTY_KV, guildId, targetId),
    findParty(c.env.PARTY_KV, guildId, partyId),
    getUserProfile(c.env.PARTY_KV, targetId),
  ])

  if (targetParty && targetParty !== partyId) {
    return c.followup({ content: `<@${targetId}> is already in party \`${targetParty}\`.`, flags: 64 })
  }

  const stub = getPartyStub(c.env, guildId, partyId)
  const ign = indexEntry ? profile.igns[indexEntry.game] : undefined
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'forceadd', {
    requesterId, userId: targetId, username: resolved.username, displayName: resolved.displayName, ign,
  })

  if (result.status === 'unauthorized')   return c.followup({ content: 'Only the party owner can add members directly.', flags: 64 })
  if (result.status === 'already_member') return c.followup({ content: `<@${targetId}> is already in the party.`, flags: 64 })
  if (result.status === 'full')           return c.followup({ content: 'The party is full. Raise the cap or remove someone first.', flags: 64 })

  await setUserPartyId(c.env.PARTY_KV, guildId, targetId, partyId)
  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

  return c.followup({ content: `<@${targetId}> added to the party.`, flags: 64 })
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

  return c.followup({ content: `<@${targetId}> removed from the queue.`, flags: 64 })
}

// ── /party remove ───────────────────────────────────────────────────────────────

async function removeUserFromParty(c: CommandContext<AppEnv>, guildId: string, requesterId: string, opts: Record<string, any>) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, requesterId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const targetId = opts['user'] as string
  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData; promoted?: string }>(stub, 'remove', { requesterId, userId: targetId })

  if (result.status === 'unauthorized') return c.followup({ content: 'Only the party owner can remove members.', flags: 64 })
  if (result.status === 'is_owner')     return c.followup({ content: "You can't remove yourself. Use `/party disband` to end the party.", flags: 64 })
  if (result.status === 'not_in')       return c.followup({ content: 'That user is not in the party.', flags: 64 })

  await setUserPartyId(c.env.PARTY_KV, guildId, targetId, null)

  if (result.promoted) {
    await setUserPartyId(c.env.PARTY_KV, guildId, result.promoted, partyId)
  }

  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)
  return c.followup({ content: `<@${targetId}> removed from the party.${result.promoted ? ` <@${result.promoted}> promoted from queue.` : ''}`, flags: 64 })
}

// ── /party promote ────────────────────────────────────────────────────────────

async function promote(c: CommandContext<AppEnv>, guildId: string, requesterId: string, opts: Record<string, any>) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, requesterId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const targetId = opts['user'] as string
  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'promote', { requesterId, userId: targetId })

  if (result.status === 'unauthorized')  return c.followup({ content: 'Only the party owner can transfer ownership.', flags: 64 })
  if (result.status === 'already_owner') return c.followup({ content: "You're already the owner.", flags: 64 })
  if (result.status === 'not_in')        return c.followup({ content: 'That user is not in the party.', flags: 64 })

  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

  return c.followup({ content: `Ownership transferred to <@${targetId}>.`, flags: 64 })
}

// ── /party size ───────────────────────────────────────────────────────────────

async function setSize(c: CommandContext<AppEnv>, guildId: string, requesterId: string, opts: Record<string, any>) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, requesterId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const newSize = opts['cap'] as number
  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData; promoted: string[] }>(stub, 'setsize', { requesterId, maxSize: newSize })

  if (result.status === 'unauthorized') return c.followup({ content: 'Only the party owner can change the party size.', flags: 64 })
  if (result.status === 'invalid')      return c.followup({ content: 'Size must be between 2 and 50.', flags: 64 })
  if (result.status === 'unchanged')    return c.followup({ content: `The cap is already ${newSize}.`, flags: 64 })
  if (result.status === 'too_small')    return c.followup({ content: `The party currently has ${result.data.members.length} members. Remove some first or pick a higher cap.`, flags: 64 })

  await Promise.all(result.promoted.map(uid =>
    setUserPartyId(c.env.PARTY_KV, guildId, uid, partyId),
  ))

  await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)

  const promotedNote = result.promoted.length > 0 ? ` ${result.promoted.length} player(s) auto-promoted from queue.` : ''
  return c.followup({ content: `Party cap set to **${newSize}**.${promotedNote}`, flags: 64 })
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

// ── /party clear (admin) ──────────────────────────────────────────────────────

async function clearAll(c: CommandContext<AppEnv>, guildId: string) {
  if (!isGuildAdmin(c.interaction)) {
    return c.followup({ content: 'Only server admins can clear all parties.', flags: 64 })
  }

  const index = await getPartyIndex(c.env.PARTY_KV, guildId)
  if (index.length === 0) return c.followup({ content: 'No active parties to clear.', flags: 64 })

  let cleared = 0
  await Promise.all(index.map(async (entry) => {
    const stub = getPartyStub(c.env, guildId, entry.id)
    const result = await callParty<{ status: string; data?: PartyData }>(stub, 'forcedisband').catch(() => null)
    if (!result || result.status === 'gone' || !result.data) return
    cleared++
    const party = result.data

    await Promise.all([
      ...party.members.map(m => setUserPartyId(c.env.PARTY_KV, guildId, m.userId, null)),
      ...party.queue.map(q => setUserPartyId(c.env.PARTY_KV, guildId, q.userId, null)),
      markDisbanded(c.env.DISCORD_BOT_TOKEN, party).catch(() => {}),
    ])
  }))

  // Reset the guild index in one shot
  await c.env.PARTY_KV.put(`guild:${guildId}:parties`, JSON.stringify([]))

  return c.followup({ content: `Cleared ${cleared} ${cleared === 1 ? 'party' : 'parties'}.`, flags: 64 })
}

// ── /party description (modal) ────────────────────────────────────────────────

async function openDescriptionModal(c: CommandContext<AppEnv>) {
  const guildId = c.interaction.guild_id!
  const { userId } = extractMemberInfo(c.interaction)

  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
  if (!partyId) {
    return c.ephemeral().res({ content: "You're not in a party.", flags: 64 })
  }

  const stub = getPartyStub(c.env, guildId, partyId)
  const party = await callParty<PartyData | null>(stub, 'get').catch(() => null)
  if (!party) return c.ephemeral().res({ content: 'Party not found.', flags: 64 })
  if (party.ownerId !== userId) {
    return c.ephemeral().res({ content: 'Only the party owner can edit the description.', flags: 64 })
  }

  const input = new TextInput('description', 'Description', 'Multi')
    .required(false)
    .max_length(1000)
    .placeholder('What is this party about? Notes, rules, etc.')
  if (party.description) input.value(party.description)

  return c.resModal(
    new Modal('party_description', 'Edit party description').custom_id(partyId).row(input),
  )
}

export async function handleDescriptionModal(c: ModalContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => {
    const partyId = c.get('custom_id') as string | undefined
    const guildId = c.interaction.guild_id!
    const { userId } = extractMemberInfo(c.interaction)

    if (!partyId) return c.followup({ content: 'Missing party context.', flags: 64 })

    const description = ((c as any).get('description') as string | undefined) ?? ''
    const stub = getPartyStub(c.env, guildId, partyId)
    const result = await callParty<{ status: string; data: PartyData }>(
      stub, 'setdescription', { requesterId: userId, description },
    ).catch(() => null)

    if (!result) return c.followup({ content: 'Party not found.', flags: 64 })
    if (result.status === 'unauthorized') {
      return c.followup({ content: 'Only the party owner can edit the description.', flags: 64 })
    }

    await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)
    return c.followup({ content: 'Description updated.', flags: 64 })
  })
}

// ── /party banlist (modal) ────────────────────────────────────────────────────

async function openBanlistModal(c: CommandContext<AppEnv>) {
  const guildId = c.interaction.guild_id!
  const { userId } = extractMemberInfo(c.interaction)

  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
  if (!partyId) {
    return c.ephemeral().res({ content: "You're not in a party.", flags: 64 })
  }

  const stub = getPartyStub(c.env, guildId, partyId)
  const party = await callParty<PartyData | null>(stub, 'get').catch(() => null)
  if (!party) return c.ephemeral().res({ content: 'Party not found.', flags: 64 })
  if (party.ownerId !== userId) {
    return c.ephemeral().res({ content: 'Only the party owner can set the banlist.', flags: 64 })
  }

  const input = new TextInput('banlist', 'Banlist (one champion per line)', 'Multi')
    .required(false)
    .max_length(2000)
    .placeholder('Aatrox\nAhri\nAkali\n...')
  const current = (party.banlist ?? []).join('\n')
  if (current) input.value(current)

  return c.resModal(
    new Modal('party_banlist', 'Edit party banlist').custom_id(partyId).row(input),
  )
}

export async function handleBanlistModal(c: ModalContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => {
    const partyId = c.get('custom_id') as string | undefined
    const guildId = c.interaction.guild_id!
    const { userId } = extractMemberInfo(c.interaction)

    if (!partyId) return c.followup({ content: 'Missing party context.', flags: 64 })

    const banlist = ((c as any).get('banlist') as string | undefined) ?? ''
    const stub = getPartyStub(c.env, guildId, partyId)
    const result = await callParty<{ status: string; data: PartyData }>(
      stub, 'setbanlist', { requesterId: userId, banlist },
    ).catch(() => null)

    if (!result) return c.followup({ content: 'Party not found.', flags: 64 })
    if (result.status === 'unauthorized') {
      return c.followup({ content: 'Only the party owner can set the banlist.', flags: 64 })
    }

    await trySyncEmbed(c.env.DISCORD_BOT_TOKEN, result.data)
    const count = result.data.banlist?.length ?? 0
    const msg = count === 0 ? 'Banlist cleared.' : `Banlist updated — ${count} entr${count === 1 ? 'y' : 'ies'}.`
    return c.followup({ content: msg, flags: 64 })
  })
}

// ── /party disband ────────────────────────────────────────────────────────────

async function disband(c: CommandContext<AppEnv>, guildId: string, userId: string) {
  const partyId = await getUserPartyId(c.env.PARTY_KV, guildId, userId)
  if (!partyId) return c.followup({ content: "You're not in a party.", flags: 64 })

  const stub = getPartyStub(c.env, guildId, partyId)
  const result = await callParty<{ status: string; data: PartyData }>(stub, 'disband', { requesterId: userId })

  if (result.status === 'unauthorized') return c.followup({ content: 'Only the party owner can disband the party.', flags: 64 })

  await Promise.all([
    ...result.data.members.map(m => setUserPartyId(c.env.PARTY_KV, guildId, m.userId, null)),
    ...result.data.queue.map(q => setUserPartyId(c.env.PARTY_KV, guildId, q.userId, null)),
    removeFromIndex(c.env.PARTY_KV, guildId, partyId),
    markDisbanded(c.env.DISCORD_BOT_TOKEN, result.data),
  ])

  return c.followup({ content: `**${result.data.name}** has been disbanded.`, flags: 64 })
}
