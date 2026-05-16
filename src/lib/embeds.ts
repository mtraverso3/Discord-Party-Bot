import type { PartyData } from '../types'

const GAME_EMOJI: Record<string, string> = {
  'LoL NA': '⚔️',
  'LoL PBE': '⚔️',
  'Starcraft 2': '🌌',
  'Valorant': '🔫',
  'Overwatch 2': '🦸',
  'Other': '🎮',
}

function embedColor(party: PartyData): number {
  if (party.isClosed) return 0xed4245
  if (party.members.length >= party.maxSize) return 0xfee75c
  return 0x57f287
}

export function buildPartyEmbed(party: PartyData) {
  const emoji = GAME_EMOJI[party.game] ?? '🎮'
  const isFull = party.members.length >= party.maxSize
  const statusLabel = party.isClosed ? '🔒 CLOSED' : isFull ? '🟡 FULL' : '🟢 OPEN'

  const memberLines = party.members
    .map((m, i) => {
      const ign = m.ign ? ` *(${m.ign})*` : ''
      const crown = m.userId === party.ownerId ? ' 👑' : ''
      return `\`${i + 1}.\` <@${m.userId}>${crown}${ign}`
    })
    .join('\n') || '*No members yet*'

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: `Members — ${party.members.length}/${party.maxSize}`,
      value: memberLines,
    },
  ]

  if (party.voiceChannelId) {
    fields.push({ name: 'Voice Channel', value: `<#${party.voiceChannelId}>`, inline: true })
  }

  if (party.queue.length > 0) {
    const queueLines = party.queue
      .map((q, i) => {
        const ign = q.ign ? ` *(${q.ign})*` : ''
        return `\`${i + 1}.\` <@${q.userId}>${ign}`
      })
      .join('\n')
    fields.push({ name: `Queue — ${party.queue.length} waiting`, value: queueLines })
  }

  return {
    title: `${emoji} ${party.name}`,
    description: party.description || null,
    color: embedColor(party),
    fields,
    footer: {
      text: `${party.game} · ${statusLabel} · ID: ${party.id} · Owner: ${party.ownerName}`,
    },
    timestamp: new Date(party.createdAt).toISOString(),
  }
}

export function buildPartyComponents(party: PartyData) {
  const isFull = party.members.length >= party.maxSize
  const showQueue = isFull || party.isClosed

  const joinButton = showQueue
    ? { type: 2, style: 2, label: 'Join Queue', custom_id: `party_queue;${party.id}` }
    : { type: 2, style: 3, label: 'Join', custom_id: `party_join;${party.id}` }

  const leaveButton = { type: 2, style: 4, label: 'Leave', custom_id: `party_leave;${party.id}` }

  return [{ type: 1, components: [joinButton, leaveButton] }]
}

export function buildDisbandedEmbed(party: PartyData) {
  return {
    title: `~~${party.name}~~`,
    description: 'This party has been disbanded.',
    color: 0x36393f,
    footer: { text: `${party.game} · DISBANDED` },
    timestamp: new Date().toISOString(),
  }
}
