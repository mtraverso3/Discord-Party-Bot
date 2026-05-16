# Discord Party Bot

A Discord bot for managing inhouse gaming lobbies. Create parties with a player cap, game label, and optional voice channel. Members join via slash command or button. When full or closed, new joiners enter a queue. The embed updates live in the channel on every state change.

Runs entirely on **Cloudflare Workers** — no persistent server, no database. State lives in Durable Objects (per party) and KV (guild index + user profiles).

## Features

- Create parties with a cap, game, description, and linked voice channel
- Live-updating embed with member list, IGNs, and queue
- Join/Leave buttons directly on the embed
- Queue system: close a party to funnel joiners to queue, approve/deny individually or re-open to auto-promote
- Per-user IGN profiles stored globally (set once, auto-filled on join/create)
- DM notifications: removed, promoted from queue, party disbanded

## Commands

| Command                    | Description                                    |
|----------------------------|------------------------------------------------|
| `/party create`            | Create a new party                             |
| `/party join <name or ID>` | Join a party or its queue                      |
| `/party leave`             | Leave your current party or queue              |
| `/party info [party]`      | Show party embed (defaults to yours)           |
| `/party list`              | List all active parties                        |
| `/party ign <game> <name>` | Save your in-game name for a game              |
| `/party game <game>`       | Change the party's current game (owner only)   |
| `/party close`             | Close your party — new joiners queue           |
| `/party open`              | Re-open and auto-promote queued players        |
| `/party adduser @user`     | Directly add a user to your party (owner only) |
| `/party approve @user`     | Approve a queued player (owner only)           |
| `/party deny @user`        | Remove a player from the queue (owner only)    |
| `/party remove @user`      | Remove a member (owner only)                   |
| `/party promote @user`     | Transfer ownership to another member           |
| `/party bump`              | Repost embed to bottom of channel (owner only) |
| `/party disband`           | Disband the party and notify everyone          |

## Stack

- **Runtime**: Cloudflare Workers (TypeScript via Wrangler)
- **Framework**: `discord-hono`
- **State**: Cloudflare Durable Objects + KV

## Setup

1. Install dependencies: `npm install`
2. Create a Discord application and bot at [discord.com/developers](https://discord.com/developers/applications)
3. Create a KV namespace via Wrangler and paste the ID into `wrangler.toml`
4. Set secrets:
   ```
   wrangler secret put DISCORD_PUBLIC_KEY
   wrangler secret put DISCORD_BOT_TOKEN
   wrangler secret put DISCORD_APPLICATION_ID
   ```
5. Register slash commands (guild for instant, global for prod):
   ```
   DISCORD_APPLICATION_ID=xxx DISCORD_BOT_TOKEN=xxx npm run register -- --guild YOUR_GUILD_ID
   ```
6. Deploy:
   ```
   npm run deploy
   ```
7. Set the deployed Worker URL as your Discord app's **Interactions Endpoint URL**
