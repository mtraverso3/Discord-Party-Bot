# Discord Party Bot

A Discord bot for managing inhouse gaming lobbies. Create parties with a player cap, game label, and optional voice channel. Members join via slash command or button. When full or closed, new joiners enter a queue. The embed updates live in the channel on every state change.

Runs entirely on **Cloudflare Workers** — no persistent server, no database. State lives in Durable Objects (per party) and KV (guild index + user profiles).

## Features

- Create parties with a cap, game, description, and linked voice channel
- Live-updating embed with member list, IGNs, and queue
- Join/Leave buttons directly on the embed
- Queue system: close a party to funnel joiners to queue, approve/deny individually or re-open to auto-promote
- Per-user IGN profiles stored globally (set once, auto-filled on join/create)
- Parties auto-disband when idle (2h solo / 6h partial / 12h full or with queue)

## Commands

| Command                    | Description                                    |
|----------------------------|------------------------------------------------|
| `/party help`              | Paged in-Discord usage guide                   |
| `/party create`            | Create a new party via modal                   |
| `/party join <name or ID>` | Join a party or its queue                      |
| `/party leave`             | Leave your current party or queue              |
| `/party info [party]`      | Show party embed (defaults to yours)           |
| `/party list`              | List all active parties                        |
| `/party ign <game> <name>` | Save your in-game name for a game              |
| `/party edit`              | Modal: edit name, description, cap, game, voice channel (owner) |
| `/party banlist`           | Assign champion bans to members in order (owner) |
| `/party close`             | Close your party — new joiners queue           |
| `/party open`              | Re-open and auto-promote queued players        |
| `/party adduser @user`     | Directly add a user to your party (owner only) |
| `/party approve @user`     | Approve a queued player (owner only)           |
| `/party deny @user`        | Remove a player from the queue (owner only)    |
| `/party remove @user`      | Remove a member (owner only)                   |
| `/party promote @user`     | Transfer ownership to another member           |
| `/party bump`              | Repost embed to bottom of channel (owner only) |
| `/party disband`           | Disband the party (owner only)                 |
| `/party clear`             | Clear all parties in this server (admin only)  |
| `/party link`              | Get a code to link the desktop client          |

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

## Admin UI (optional)

`/admin` serves a private web app for managing the bot — protected by Cloudflare Zero Trust (Access). It's a single inline asset served by the Worker: no build step, no framework.

- **Guild picker** — lists the servers the bot is in; remembers your last one
- **Dashboard** — party/member/queue stats, per-game breakdown, upcoming auto-disbands
- **Parties** — everything the owner commands can do (edit, close/open, members, queue, banlist, disband) plus search/sort, auto-refresh, queue reordering, embed bumping, and creating parties on a member's behalf
- **Templates** — save reusable party blueprints (title, description, game, player cap, voice channel, banlist) and spin up a party for any member in one form, without re-entering everything each time
- **Users** — inspect and edit any member's per-game IGN profile, and repair stale user→party mappings
- **Audit log** — the last 200 admin actions with the acting admin's email
- **Settings** — per-guild limits enforced by the bot: max concurrent parties, default player cap, allowed games, desktop client inviters

1. In Cloudflare Zero Trust, create an Access Application covering `<your-domain>/admin*` with a policy allowing your email.
2. Set the team subdomain and Application AUD on the Worker:
   ```
   wrangler secret put CF_ACCESS_TEAM   # e.g. mtraverso  (from <team>.cloudflareaccess.com)
   wrangler secret put CF_ACCESS_AUD    # Application AUD tag from the Access app
   ```
3. Without those vars set, `/admin` returns 503. The Worker also verifies the Access JWT in-process as defense in depth, so traffic that bypasses Access is rejected.
4. Visit `https://<your-domain>/admin?guild=<guild-id>`.

## Desktop client (optional)

A portable Windows app (`client/`) for party leaders running League of Legends. It links to your Discord identity once via `/party link`, then lets the party owner (or admin-allowlisted members) create a League lobby and invite every party member by their IGN in one click — members don't install anything. It also cross-references the live League lobby against the party roster and flags anyone in the lobby who isn't in the party.

Built as a single portable `.exe` (Electron) by the **Desktop client** GitHub Actions workflow — run it manually or push a `client-v*` tag to publish a release. See [client/README.md](client/README.md).
