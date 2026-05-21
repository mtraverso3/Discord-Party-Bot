import type { PartyData } from '../types'

function embedColor(party: PartyData): number {
  if (party.isClosed) return 0xed4245
  if (party.members.length >= party.maxSize) return 0xfee75c
  return 0x57f287
}

export function buildPartyEmbed(party: PartyData) {
  const isFull = party.members.length >= party.maxSize
  const statusLabel = party.isClosed ? '🔒 CLOSED' : isFull ? '🟡 FULL' : '🟢 OPEN'

  const memberLines = party.members
    .map((m, i) => {
      const ign = m.ign ? ` *(${m.ign})*` : ''
      const crown = m.userId === party.ownerId ? ' 👑' : ''
      const assigned = party.banlist?.assignments[m.userId]
      const ban = assigned ? ` — 🚫 **${assigned}**` : ''
      return `\`${i + 1}.\` <@${m.userId}>${crown}${ign}${ban}`
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
    title: party.name,
    description: party.description || null,
    color: embedColor(party),
    fields,
    footer: {
      text: `${party.game} · ${statusLabel} · ID: ${party.id}`,
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

// ── Help pages ──────────────────────────────────────────────────────────────

export const HELP_PAGES = 3

const SOURCE_URL = 'https://github.com/mtraverso3/Discord-Party-Bot'

export function buildHelpEmbed(page: number) {
  if (page === 1) {
    return {
      title: 'PartyBot — Getting Started',
      color: 0x5865f2,
      description: 'How to make and join parties.',
      fields: [
        {
          name: '1. Make a party',
          value: 'Type `/party create`. A small form pops up — fill in the game, how many players, and the voice channel.',
        },
        {
          name: '2. Tell us your in-game name',
          value: 'Type `/party ign`, pick a game, then type your name in that game. The bot remembers it, so other players know who you are.',
        },
        {
          name: '3. Join a party',
          value: 'Click the green **Join** button on a party message. Or use `/party list` to see what\'s out there, then `/party join` to hop in.\n\nUse `/party leave` anytime to leave.',
        },
      ],
      footer: { text: 'Page 1 / 3 · Getting Started' },
    }
  }

  if (page === 2) {
    return {
      title: 'PartyBot — Owner Controls',
      color: 0x5865f2,
      description: 'Once your party exists, these let you run it.',
      fields: [
        {
          name: 'Members',
          value: '`/party adduser @user` — directly add\n`/party remove @user` — remove a member\n`/party promote @user` — transfer ownership',
        },
        {
          name: 'Queue',
          value: '`/party close` — funnel new joiners to the queue\n`/party open` — re-open and auto-promote from queue\n`/party approve @user` — let a queued player in\n`/party deny @user` — remove a player from the queue',
        },
        {
          name: 'Adjust',
          value: "`/party edit` — modal to change name, description, player cap, game, and voice channel\n`/party banlist` — paste a list of bans to auto-assign per member\n`/party bump` — repost the embed to the bottom of the channel",
        },
        {
          name: 'End',
          value: '`/party disband` — end the party\n*Parties auto-disband after 12 hours of inactivity.*',
        },
      ],
      footer: { text: 'Page 2 / 3 · Owner Controls' },
    }
  }

  return {
    title: 'PartyBot — About',
    color: 0x5865f2,
    description: 'Runs on Cloudflare Workers + Durable Objects. Open source.',
    fields: [
      {
        name: 'Source code',
        value: `[${SOURCE_URL.replace('https://', '')}](${SOURCE_URL})`,
      },
      {
        name: 'Issues / pings',
        value: 'Ping **@mtraverso** or **@aureateAnatidae** for issues, bugs, or feature requests.',
      },
    ],
    footer: { text: 'Page 3 / 3 · About' },
  }
}

export function buildHelpComponents(page: number) {
  return [{
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: '◀ Previous',
        custom_id: `help_page;${page - 1}`,
        disabled: page <= 1,
      },
      {
        type: 2,
        style: 2,
        label: 'Next ▶',
        custom_id: `help_page;${page + 1}`,
        disabled: page >= HELP_PAGES,
      },
    ],
  }]
}

export function buildDisbandedEmbed(party: PartyData, reason?: string) {
  return {
    title: `~~${party.name}~~`,
    description: reason ? `This party has been disbanded — ${reason}.` : 'This party has been disbanded.',
    color: 0x36393f,
    footer: { text: `${party.game} · DISBANDED` },
    timestamp: new Date().toISOString(),
  }
}
