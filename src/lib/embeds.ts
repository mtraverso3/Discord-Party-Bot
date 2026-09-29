import type { PartyData } from '../types'

// The party ID as it appears in the embed footer — also what
// isPartyEmbedMessage matches on, so the two stay in step.
function partyIdFooter(party: PartyData): string {
  return `ID: ${party.id}`
}

function embedColor(party: PartyData): number {
  if (party.isClosed) return 0xed4245
  if (party.members.length >= party.maxSize) return 0xfee75c
  return 0x57f287
}

/**
 * `rulesEnforced` is whether the check is actually being applied to this party
 * right now — the party asked for it *and* the server still runs one. It is
 * separate from party.rulesRequired, which is the party's stored setting and
 * survives the server switching the feature off.
 */
export function buildPartyEmbed(party: PartyData, rulesEnforced = party.rulesRequired) {
  const isFull = party.members.length >= party.maxSize
  const statusLabel = party.isClosed ? '🔒 CLOSED' : isFull ? '🟡 FULL' : '🟢 OPEN'

  const memberLines = party.members.map((m, i) => {
    const ign = m.ign ? ` *(${m.ign})*` : ''
    const crown = m.userId === party.ownerId ? ' 👑' : ''
    const away = m.away ? ' 💤' : ''
    const assigned = party.banlist?.assignments[m.userId]
    const ban = assigned ? ` — 🚫 **${assigned}**` : ''
    return `\`${i + 1}.\` <@${m.userId}>${crown}${away}${ign}${ban}`
  })
  const queueLines = party.queue.map((q, i) => {
    const ign = q.ign ? ` *(${q.ign})*` : ''
    return `\`${i + 1}.\` <@${q.userId}>${ign}`
  })

  const awayCount = party.members.filter(m => m.away).length
  const membersName = `Members — ${party.members.length}/${party.maxSize}`
    + (awayCount > 0 ? ` · 💤 ${awayCount} away` : '')
  const queueName = `Queue — ${party.queue.length} waiting`
  const voice = party.voiceChannelId
    ? { name: 'Voice Channel', value: `<#${party.voiceChannelId}>`, inline: true }
    : null

  const embed = {
    title: party.name,
    description: party.description || null,
    color: embedColor(party),
    fields: [] as EmbedField[],
    footer: {
      text: `${party.game} · ${statusLabel}`
        + (rulesEnforced ? ' · 🔒 Rules check required' : '')
        + ` · ${partyIdFooter(party)}`,
    },
    timestamp: new Date(party.createdAt).toISOString(),
  }

  let budget = EMBED_MAX - embedSize(embed) - (voice ? voice.name.length + voice.value.length : 0)
  const members = memberLines.length > 0
    ? listFields(membersName, memberLines, budget - (queueLines.length > 0 ? QUEUE_RESERVE : 0))
    : [{ name: membersName, value: '*No members yet*' }]
  budget -= fieldsSize(members)
  embed.fields.push(...members)
  if (voice) embed.fields.push(voice)
  if (queueLines.length > 0) embed.fields.push(...listFields(queueName, queueLines, budget))
  return embed
}

// Discord's embed limits.
const FIELD_VALUE_MAX = 1024
const EMBED_MAX = 6000
// Keeps one oversized entry (a long banlist line) from crowding out the rest.
const LINE_MAX = 200
// Held back from the member list so a long roster can't squeeze out the queue.
const QUEUE_RESERVE = 150
const CONTINUED = '​'

interface EmbedField { name: string; value: string; inline?: boolean }

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function fieldsSize(fields: EmbedField[]): number {
  return fields.reduce((n, f) => n + f.name.length + f.value.length, 0)
}

/** The characters Discord counts toward an embed's total. */
export function embedSize(embed: { title?: string; description?: string | null; fields?: EmbedField[]; footer?: { text?: string } }): number {
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0)
    + fieldsSize(embed.fields ?? []) + (embed.footer?.text?.length ?? 0)
}

/**
 * One line per entry, spread over as many fields as the per-field limit needs.
 * Anything past `budget` characters is summarised as "…and N more".
 */
function listFields(name: string, lines: string[], budget: number): EmbedField[] {
  const values: string[][] = [[]]
  let used = name.length
  const valueLength = (v: string[]) => v.reduce((n, l) => n + l.length, 0) + Math.max(v.length - 1, 0)

  for (let i = 0; i < lines.length; i++) {
    const line = clip(lines[i]!, LINE_MAX)
    const more = `…and ${lines.length - i} more`
    const current = values.at(-1)!
    const newField = current.length > 0 && valueLength(current) + 1 + line.length > FIELD_VALUE_MAX
    const cost = line.length + (newField ? CONTINUED.length : current.length > 0 ? 1 : 0)
    const last = i === lines.length - 1
    if (used + cost + (last ? 0 : more.length + 2) > budget) {
      if (current.length > 0 && valueLength(current) + 1 + more.length > FIELD_VALUE_MAX) values.push([])
      values.at(-1)!.push(more)
      break
    }
    if (newField) values.push([])
    values.at(-1)!.push(line)
    used += cost
  }

  return values.map((v, i) => ({ name: i === 0 ? name : CONTINUED, value: v.join('\n') }))
}

/**
 * Whether `message` is one of our embeds for this exact party *run*. The
 * footer ID pins the party, and the embed timestamp — which is the party's
 * creation time — pins the run, so a leftover message from an older party
 * that happened to draw the same short ID never matches. Callers still have
 * to confirm the message was posted by the bot.
 */
export function isPartyEmbedMessage(
  message: { embeds?: Array<{ timestamp?: string; footer?: { text?: string } }> },
  party: PartyData,
): boolean {
  const embed = message.embeds?.[0]
  if (!embed?.footer?.text?.endsWith(partyIdFooter(party))) return false
  // Discord echoes the timestamp back with its own precision and offset
  // format, so compare the instants at second granularity, not the strings.
  const posted = Date.parse(embed.timestamp ?? '')
  return !Number.isNaN(posted) && Math.floor(posted / 1000) === Math.floor(party.createdAt / 1000)
}

export function buildPartyComponents(party: PartyData) {
  const isFull = party.members.length >= party.maxSize
  const showQueue = isFull || party.isClosed

  const joinButton = showQueue
    ? { type: 2, style: 2, label: 'Join Queue', custom_id: `party_queue;${party.id}` }
    : { type: 2, style: 3, label: 'Join', custom_id: `party_join;${party.id}` }

  const leaveButton = { type: 2, style: 4, label: 'Leave', custom_id: `party_leave;${party.id}` }
  // Members toggle a 💤 marker next to their name (brb / back).
  const awayButton = { type: 2, style: 2, label: '💤 BRB', custom_id: `party_away;${party.id}` }

  return [{ type: 1, components: [joinButton, leaveButton, awayButton] }]
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
          value: 'Click the green **Join** button on a party message. Or use `/party list` to see what\'s out there, then `/party join` to hop in.\n\nUse `/party leave` anytime to leave. Stepping away for a bit? Click **💤 BRB** to mark yourself away — click it again when you\'re back.',
        },
        {
          name: '4. Rules check (some servers)',
          value: 'Parties marked 🔒 need you to pass this server\'s rules check first.\n`/party rules read` — read the rules\n`/party rules quiz` — take the check\n`/party rules status` — see where you stand',
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
          value: '`/party disband` — end the party\n*Parties auto-disband when idle — about 2h if solo, 6h with a few players, up to 12h when full or with a queue.*',
        },
      ],
      footer: { text: 'Page 2 / 3 · Owner Controls' },
    }
  }

  return {
    title: 'PartyBot — About',
    color: 0x5865f2,
    description: 'Runs on Cloudflare Workers + D1. Open source.',
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
