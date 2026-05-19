/**
 * Registers (or updates) slash commands with Discord.
 *
 * Usage:
 *   DISCORD_APPLICATION_ID=xxx DISCORD_BOT_TOKEN=xxx npx tsx scripts/register.ts
 *
 * Pass --guild <GUILD_ID> to register to a single guild (instant, good for testing).
 * Omit --guild to register globally (takes up to 1 hour to propagate).
 */

import { GAMES } from '../src/lib/games'

const APP_ID = process.env['DISCORD_APPLICATION_ID']
const TOKEN = process.env['DISCORD_BOT_TOKEN']

if (!APP_ID || !TOKEN) {
  console.error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN environment variables.')
  process.exit(1)
}

const guildArg = process.argv.indexOf('--guild')
const guildId = guildArg !== -1 ? process.argv[guildArg + 1] : undefined
const endpoint = guildId
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`

const commands = [
  {
    name: 'party',
    description: 'Party management for inhouse games',
    options: [
      {
        type: 1,
        name: 'help',
        description: 'Show how to use PartyBot',
      },
      {
        type: 1,
        name: 'create',
        description: 'Create a new party (opens a modal)',
      },
      {
        type: 1,
        name: 'join',
        description: 'Join a party (or its queue if full/closed)',
        options: [
          { type: 3, name: 'party', description: 'Party name or ID', required: true },
        ],
      },
      {
        type: 1,
        name: 'leave',
        description: 'Leave your current party or queue',
      },
      {
        type: 1,
        name: 'info',
        description: 'Show party info',
        options: [
          { type: 3, name: 'party', description: 'Party name or ID (defaults to your current party)', required: false },
        ],
      },
      {
        type: 1,
        name: 'list',
        description: 'List all active parties in this server',
      },
      {
        type: 1,
        name: 'ign',
        description: 'Set your in-game name for a game (saves to profile)',
        options: [
          { type: 3, name: 'game', description: 'Game to set IGN for', required: true, choices: GAMES },
          { type: 3, name: 'name', description: 'Your in-game name / summoner name', required: true },
        ],
      },
      {
        type: 1,
        name: 'edit',
        description: 'Edit name, description, cap, game, and open/closed status in one modal (owner only)',
      },
      {
        type: 1,
        name: 'voice',
        description: "Change your party's linked voice channel (owner only)",
        options: [
          { type: 7, name: 'voice-channel', description: 'New voice channel', required: true, channel_types: [2] },
        ],
      },
      {
        type: 1,
        name: 'banlist',
        description: 'Set a banlist — members get assigned a ban in order (owner only)',
      },
      {
        type: 1,
        name: 'adduser',
        description: 'Directly add a user to your party (owner only)',
        options: [
          { type: 6, name: 'user', description: 'User to add', required: true },
        ],
      },
      {
        type: 1,
        name: 'approve',
        description: 'Approve a queued player into the party (owner only)',
        options: [
          { type: 6, name: 'user', description: 'User to approve', required: true },
        ],
      },
      {
        type: 1,
        name: 'deny',
        description: 'Remove a player from the queue (owner only)',
        options: [
          { type: 6, name: 'user', description: 'User to deny', required: true },
        ],
      },
      {
        type: 1,
        name: 'remove',
        description: 'Remove a member from your party (owner only)',
        options: [
          { type: 6, name: 'user', description: 'User to remove from party', required: true },
        ],
      },
      {
        type: 1,
        name: 'promote',
        description: 'Transfer ownership of your party to another member (owner only)',
        options: [
          { type: 6, name: 'user', description: 'New owner', required: true },
        ],
      },
      {
        type: 1,
        name: 'disband',
        description: 'Disband your party (owner only)',
      },
      {
        type: 1,
        name: 'bump',
        description: 'Repost the party embed to the bottom of this channel (owner only)',
      },
      {
        type: 1,
        name: 'clear',
        description: 'Clear all active parties in this server (admin only)',
        default_member_permissions: '8',
      },
    ],
  },
]

async function main() {
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  })

  if (res.ok) {
    const data = await res.json()
    console.log(`Registered ${(data as any[]).length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}.`)
  } else {
    console.error('Failed:', res.status, await res.text())
    process.exit(1)
  }
}

main()
