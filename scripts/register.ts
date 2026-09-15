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
    dm_permission: false,
    contexts: [0], // guild only
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
        options: [
          {
            type: 5, name: 'rules', required: false,
            description: 'Require the server rules check to join this party',
          },
        ],
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
        description: 'Edit name, description, cap, game, and voice channel in one modal (owner only)',
        options: [
          {
            type: 5, name: 'rules', required: false,
            description: "Turn this party's rules check on or off (blank leaves it as is)",
          },
        ],
      },
      {
        type: 1,
        name: 'banlist',
        description: 'Set a banlist — members get assigned a ban in order (owner only)',
      },
      {
        type: 1,
        name: 'close',
        description: 'Close your party — new joiners go to queue (owner only)',
      },
      {
        type: 1,
        name: 'open',
        description: 'Re-open your closed party (owner only)',
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
      // Anyone may read the rules and check their own status.
      {
        type: 1,
        name: 'rules',
        description: "Read this server's rules, privately, a page at a time",
      },
      {
        type: 1,
        name: 'rules-status',
        description: 'Privately show your approval status, revocations, and completed checks',
      },
      // The rest gate on Manage Roles at runtime: Discord ignores
      // default_member_permissions on subcommands.
      {
        type: 1,
        name: 'rules-post',
        description: 'Post the Start rules check button in the configured channel (Manage Roles)',
      },
      {
        type: 1,
        name: 'rules-approve',
        description: 'Approve a member without the quiz, vouching for them (Manage Roles)',
        options: [
          { type: 6, name: 'member', description: 'The member to approve', required: true },
          { type: 3, name: 'reason', description: 'Recorded against them; shown in their history', required: true },
        ],
      },
      {
        type: 1,
        name: 'rules-history',
        description: "Show a member's counters and their latest history entries (Manage Roles)",
        options: [
          { type: 6, name: 'member', description: 'The member to look up', required: true },
        ],
      },
      {
        type: 1,
        name: 'rules-revoke',
        description: 'Remove approval and require a fresh check, counting a revocation (Manage Roles)',
        options: [
          { type: 6, name: 'member', description: 'The member to revoke', required: true },
          { type: 3, name: 'reason', description: 'Recorded against them; shown in their history', required: true },
        ],
      },
      {
        type: 1,
        name: 'rules-reset',
        description: 'Require a fresh check without adding a disciplinary count (Manage Roles)',
        options: [
          { type: 6, name: 'member', description: 'The member to reset', required: true },
          { type: 3, name: 'reason', description: 'Recorded against them; shown in their history', required: true },
        ],
      },
      {
        type: 1,
        name: 'link',
        description: 'Get a code to link your League client to this party via the PartyBot desktop app',
      },
      {
        type: 1,
        name: 'clear',
        // NOTE: Discord ignores default_member_permissions on subcommands —
        // admin gating happens at runtime via isGuildAdmin().
        description: 'Clear all active parties in this server (admin only)',
      },
      {
        type: 1,
        name: 'admin',
        // Allow-list gated at runtime via the admin_users table (isAdmin()).
        description: 'Get a private link to sign in to the PartyBot admin panel (allow-listed users only)',
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
