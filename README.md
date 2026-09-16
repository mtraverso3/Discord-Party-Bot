# Discord Party Bot

A Discord bot for running inhouse gaming lobbies. Members create parties with a
player cap, a game and an optional voice channel, join by slash command or
button, and queue up when a party is full or closed. One live embed per party
tracks the roster and updates on every change.

It runs entirely on **Cloudflare Workers** with **Cloudflare D1** for state, so
there is no server to keep alive. A web dashboard, an optional rules check for
gating parties, and an optional desktop companion app for League of Legends
round it out.

## Features

- Parties with a cap, game label, description and linked voice channel
- A live embed with the member list, IGNs and queue, plus Join/Leave buttons
- A queue that fills when a party is full or closed. Approve players one by
  one, or re-open to auto-promote
- Per-user IGN profiles, saved once and auto-filled on join and create
- Automatic disband when a party goes idle (2h solo / 6h partial / 12h full or
  queued)
- Party history: who joined, left or was promoted, browsable long after the
  party is gone
- League match history, recorded by the desktop client and filled in with
  participants and champions from the Riot API
- A [web dashboard](docs/admin-ui.md) for managing parties, templates, members
  and per-guild settings
- An optional [rules check](docs/rules-check.md) that members must pass before
  they can join

## Commands

`/party help` prints a paged guide inside Discord. The full list of commands is
in [docs/commands.md](docs/commands.md).

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Create a Discord application and bot at
   [discord.com/developers](https://discord.com/developers/applications).
3. Create the D1 database and apply the schema:
   ```
   wrangler d1 create partybot        # paste the database_id into wrangler.toml
   wrangler d1 migrations apply partybot --remote
   ```
4. Set the secrets:
   ```
   wrangler secret put DISCORD_PUBLIC_KEY
   wrangler secret put DISCORD_BOT_TOKEN
   wrangler secret put DISCORD_APPLICATION_ID
   ```
5. Register the slash commands. Use a guild for instant updates, global for
   production:
   ```
   DISCORD_APPLICATION_ID=xxx DISCORD_BOT_TOKEN=xxx npm run register -- --guild YOUR_GUILD_ID
   ```
6. Deploy:
   ```
   npm run deploy
   ```
7. Set the deployed Worker URL as the app's **Interactions Endpoint URL** in the
   Discord developer portal.

The dashboard and the rules check are configured after deploying. See the docs
below.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Commands](docs/commands.md) | Every slash command and who can run it |
| [Admin dashboard](docs/admin-ui.md) | The `/admin` web app, Cloudflare Access, and Discord admin login |
| [Rules check](docs/rules-check.md) | Gating parties behind rules pages, a quiz and an agreement |
| [Desktop client](client/README.md) | The League companion app, and troubleshooting it |
| [Migrating from KV](docs/migrating-from-kv.md) | One-time import for deployments that predate D1 |

## Development

```sh
npm install
npm test           # vitest, against the Workers runtime
npm run dev        # wrangler dev, with the dashboard built first
npm run deploy
```

- **Runtime**: Cloudflare Workers, TypeScript via Wrangler
- **Framework**: `discord-hono`
- **State**: Cloudflare D1, with the schema in `migrations/` and the queries in
  `src/store/`
- **Dashboard**: React + Vite in `admin-ui/`, served by the Worker as static
  assets

All state lives in D1: parties, members and queues, banlists, IGN profiles,
guild settings, templates, the audit log and desktop-client auth. Invariants
like "one party per user per guild" are database constraints, and a cron
trigger sweeps idle parties.
