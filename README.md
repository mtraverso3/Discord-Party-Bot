# Discord Party Bot

A Discord bot for managing inhouse gaming lobbies. Create parties with a player cap, game label, and optional voice channel. Members join via slash command or button. When full or closed, new joiners enter a queue. The embed updates live in the channel on every state change.

Runs entirely on **Cloudflare Workers** — no persistent server. All state lives in a **Cloudflare D1** (SQLite) database: parties, members and queues, banlists, per-user IGN profiles, guild settings, templates, the admin audit log, and desktop-client auth. Invariants like "one party per user per guild" are database constraints, and a cron trigger sweeps idle parties.

## Features

- Create parties with a cap, game, description, and linked voice channel
- Live-updating embed with member list, IGNs, and queue
- Join/Leave buttons directly on the embed
- Queue system: close a party to funnel joiners to queue, approve/deny individually or re-open to auto-promote
- Per-user IGN profiles stored globally (set once, auto-filled on join/create)
- Parties auto-disband when idle (2h solo / 6h partial / 12h full or with queue)
- Party history: every party is recorded — who joined, left, or was promoted, plus close/open/game/owner changes — and browsable in the admin UI long after it's disbanded
- League game history: the desktop client reports each match a party plays; the bot fills in the participants and champions from the Riot API

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
| `/party bump`              | Repost embed to bottom of channel (owner or designated bumper) |
| `/party disband`           | Disband the party (owner only)                 |
| `/party clear`             | Clear all parties in this server (admin only)  |
| `/party link`              | Get a code to link the desktop client          |
| `/party admin`             | Get a private link to sign in to the admin UI (allow-listed users only) |

## Stack

- **Runtime**: Cloudflare Workers (TypeScript via Wrangler)
- **Framework**: `discord-hono`
- **State**: Cloudflare D1 (schema in `migrations/`, data access in `src/store/`)

## Setup

1. Install dependencies: `npm install`
2. Create a Discord application and bot at [discord.com/developers](https://discord.com/developers/applications)
3. Create the D1 database and apply the schema:
   ```
   wrangler d1 create partybot        # paste the database_id into wrangler.toml
   wrangler d1 migrations apply partybot --remote
   ```
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

### Migrating from the KV/Durable Object version

Older deployments stored state in KV + Durable Objects. After deploying the D1 version, hit `POST /admin/api/import-kv` (through the Access-protected admin API) once to copy the durable data — user IGN profiles, guild settings, templates, and desktop-client tokens — into D1. Live parties are ephemeral and start fresh. Once verified, remove the `PARTY_KV` binding from `wrangler.toml` and delete `src/admin/import.ts`.

## Admin UI (optional)

`/admin` serves a private web app for managing the bot — protected by Cloudflare Zero Trust (Access). It's a React + Vite SPA (`admin-ui/`) built to static assets and served by the Worker through the Workers static-assets binding; `npm run deploy` builds it automatically. Every request still goes through the Worker first (`run_worker_first`), so the Access JWT check gates the UI and its assets.

- **Guild picker** — lists the servers the bot is in; remembers your last one
- **Dashboard** — party/member/queue stats, per-game breakdown, upcoming auto-disbands
- **Parties** — everything the owner commands can do (edit, close/open, members, queue, banlist, disband) plus search/sort, auto-refresh, queue reordering, embed bumping, and creating parties on a member's behalf
- **Templates** — save reusable party blueprints (title, description, game, player cap, voice channel, banlist) and spin up a party for any member in one form, without re-entering everything each time
- **History** — every past and present party session, with a timeline of who came and went and the League games played in it (champions, teams, win/loss)
- **Users** — a member profile deep-linked by ID (survives refresh and is shareable): per-game IGN profile, admin notes, party history, League games played, live stats, and a jump to their current party
- **Audit log** — the last 200 admin actions with the acting admin's email (or Discord name, for Discord-identity admins)
- **Admins** — manage the Discord users allowed to sign in via `/party admin` (see [Discord admin login](#discord-admin-login-optional))
- **Settings** — per-guild limits enforced by the bot: max concurrent parties, default player cap, allowed games, desktop client inviters

1. In Cloudflare Zero Trust, create an Access Application covering `<your-domain>/admin*` with a policy allowing your email.
2. Set the team subdomain and Application AUD on the Worker:
   ```
   wrangler secret put CF_ACCESS_TEAM   # e.g. mtraverso  (from <team>.cloudflareaccess.com)
   wrangler secret put CF_ACCESS_AUD    # Application AUD tag from the Access app
   ```
3. Without those vars set, `/admin` returns 503. The Worker also verifies the Access JWT in-process as defense in depth, so traffic that bypasses Access is rejected.
4. Visit `https://<your-domain>/admin?guild=<guild-id>`.

To hack on the UI itself: run `wrangler dev` in the repo root and `npm run dev` in `admin-ui/` — the Vite dev server proxies `/admin/api` to the Worker and hot-reloads the SPA.

### Discord admin login (optional)

Lets you allow specific **Discord users** into the admin UI without giving them an email in the Access policy — and without any Discord OAuth. Cloudflare Access still fronts `/admin*`; the difference is only *how* a session is obtained.

**Super admins vs. magic-link admins.** Signing in with a real email through Cloudflare Access makes you a **super admin**: you can see and manage every guild and are the only one who can add or remove magic-link admins. **Magic-link admins** (added per guild in the **Admins** page and signed in via `/party admin`) are scoped to the single guild that granted them access — they only ever see that one server and can't touch the allow-list.

**How it works.** A guild's allow-listed user runs `/party admin` in that guild and gets a single-use link. Opening it drops a signed 24h session cookie pinned to that guild (the Discord slash-command interaction *is* the proof of identity). From there the Worker acts as a small OIDC identity provider: hitting `/admin` bounces through Cloudflare Access → the Worker's `/oidc/authorize`, which reads that cookie and issues Access an identity of `<discordId>@<guildId>.<domain>`. The guild subdomain is how the scope survives the hop through Access — the admin API parses it back out to pin the session to that one guild. Access mints its own JWT as usual, so the existing in-Worker verification and audit trail are unchanged — actions are attributed to the Discord user (shown by name on the **Admins**/**Audit** pages). Email SSO keeps working alongside this. The OIDC and login endpoints (`/oidc/*`, `/auth/*`, `/.well-known/openid-configuration`) live **outside** the Access application so the browser and Access can reach them; keep the main Access app scoped to `/admin*` only.

**Setup:**

1. Generate an RSA signing key and store it as a secret:
   ```
   npx tsx scripts/gen-oidc-key.ts | wrangler secret put OIDC_PRIVATE_JWK
   ```
2. Set the remaining secrets (pick your own client id/secret — they just have to match what you enter in Access next):
   ```
   wrangler secret put PUBLIC_BASE_URL        # e.g. https://partybot.example.com (scheme optional — https assumed)
   wrangler secret put ADMIN_SESSION_SECRET   # any long random string
   wrangler secret put OIDC_CLIENT_ID
   wrangler secret put OIDC_CLIENT_SECRET
   # optional: OIDC_EMAIL_DOMAIN (default "discord.local"), OIDC_REDIRECT_URI (override)
   ```
3. In Cloudflare Zero Trust → **Settings → Authentication → Login methods → Add new → OpenID Connect**:
   - **App ID** / **Client secret**: the `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` you chose.
   - **Auth URL**: `https://<your-domain>/oidc/authorize`
   - **Token URL**: `https://<your-domain>/oidc/token`
   - **Certificate URL**: `https://<your-domain>/oidc/jwks`
   - Enable **PKCE**. Save, then **Test** — it should sign in cleanly once a session cookie exists.
4. On the Access application covering `/admin*`, add this OIDC provider as an allowed login method (keep your email SSO method too if you want both). The Worker's allow-list is the real gate, so a broad "allow everyone via this IdP" policy rule is fine.
5. Seed a magic-link admin for a specific guild (super admins who sign in with an allowed email don't need seeding — they can add magic-link admins per guild from the UI):
   ```
   wrangler d1 execute partybot --remote --command \
     "INSERT INTO admin_users (guild_id, user_id, display_name, added_at) VALUES ('YOUR_GUILD_ID', 'YOUR_DISCORD_ID', 'You', unixepoch()*1000)"
   ```
6. Run `/party admin` in that guild and open the link. Super admins manage each guild's allow-list from the admin UI's **Admins** page.

Removing a user from a guild's allow-list cuts them off at their next Access re-auth (the `/oidc/authorize` step re-checks the list even against a still-valid cookie). All the login credentials are short-lived and swept by the existing cron.

## Desktop client (optional)

A portable Windows app (`client/`) for party leaders running League of Legends. It links to your Discord identity once via `/party link`, then lets the party owner (or admin-allowlisted members) create a League lobby and invite every party member by their IGN in one click — members don't install anything. It also cross-references the live League lobby against the party roster and flags anyone in the lobby who isn't in the party.

When a linked member starts a League match, the client also reports the game (its ID + region) to the bot, which records it against the party and — with `RIOT_API_KEY` set — resolves the participants and champions from the Riot Match-v5 API on the next cron sweep. Those games show up under the party's **Games** tab and in the **History** view.

Built as a single portable `.exe` (Electron) by the **Desktop client** GitHub Actions workflow — run it manually or push a `client-v*` tag to publish a release. See [client/README.md](client/README.md).
