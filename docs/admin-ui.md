# Admin dashboard

`/admin` serves a private web app for managing the bot, protected by Cloudflare
Zero Trust (Access). It is optional: without the Access settings below, `/admin`
returns 503 and the bot runs on slash commands alone.

The dashboard is a React + Vite SPA (`admin-ui/`) built to static assets and
served by the Worker; `npm run deploy` builds it. Every request goes through the
Worker first (`run_worker_first`), so the Access JWT check gates the UI and its
assets alike.

## What is in it

- **Guild picker**: the servers the bot is in. It remembers your last one.
- **Dashboard**: party, member and queue stats, a per-game breakdown, and
  upcoming auto-disbands.
- **Parties**: everything the owner commands can do (edit, close/open, members,
  queue, banlist, disband) plus search and sort, auto-refresh, queue reordering,
  embed bumping, and creating a party on a member's behalf.
- **Templates**: reusable party blueprints (title, description, game, cap, voice
  channel, banlist) that spin up a party for any member in one form.
- **History**: every past and present party, with a timeline of who came and
  went and the League games played (champions, teams, win/loss).
- **Users**: a member profile deep-linked by ID, with per-game IGNs, admin
  notes, party history, League games, live stats, and a jump to their current
  party.
- **Rules & verification**: the [rules check](rules-check.md), covering the
  rules pages, the quiz, and member approvals.
- **Audit log**: the last 200 admin actions with the acting admin's email, or
  Discord name for Discord-identity admins.
- **Admins**: the Discord users allowed to sign in via `/party admin`.
- **Settings**: the per-guild limits the bot enforces, such as max concurrent
  parties, default player cap, allowed games and desktop client inviters.

## Setup

1. In Cloudflare Zero Trust, create an Access application covering
   `<your-domain>/admin*` with a policy allowing your email.
2. Set the team subdomain and application AUD on the Worker:
   ```
   wrangler secret put CF_ACCESS_TEAM   # e.g. mtraverso, from <team>.cloudflareaccess.com
   wrangler secret put CF_ACCESS_AUD    # the Application AUD tag from the Access app
   ```
3. Visit `https://<your-domain>/admin?guild=<guild-id>`.

The Worker verifies the Access JWT in-process as well, so traffic that bypasses
Access is rejected.

To work on the UI itself, run `wrangler dev` in the repo root and `npm run dev`
in `admin-ui/`. The Vite dev server proxies `/admin/api` to the Worker and
hot-reloads the SPA.

## Discord admin login (optional)

This lets specific **Discord users** into the dashboard without giving them an
email in the Access policy, and without Discord OAuth. Cloudflare Access still
fronts `/admin*`; only the way a session is obtained changes.

**Super admins vs. magic-link admins.** Signing in with a real email through
Cloudflare Access makes you a **super admin**: you see and manage every guild,
and you are the only one who can add or remove magic-link admins.
**Magic-link admins** are added per guild on the **Admins** page and sign in via
`/party admin`. They are scoped to the guild that granted them access, so they
only ever see that server, and they cannot touch the allow-list.

**How it works.** An allow-listed user runs `/party admin` in their guild and
gets a single-use link. Opening it drops a signed 24-hour session cookie pinned
to that guild; the slash-command interaction is itself the proof of identity.
From there the Worker acts as a small OIDC identity provider: `/admin` bounces
through Cloudflare Access to the Worker's `/oidc/authorize`, which reads the
cookie and hands Access an identity of `<discordId>@<guildId>.<domain>`. The
guild subdomain is how the scope survives the hop through Access: the admin API
parses it back out to pin the session to that one guild.

Access mints its own JWT as usual, so the in-Worker verification and the audit
trail are unchanged; actions are attributed to the Discord user and shown by
name on the **Admins** and **Audit** pages. Email SSO keeps working alongside
this.

The OIDC and login endpoints (`/oidc/*`, `/auth/*`,
`/.well-known/openid-configuration`) live **outside** the Access application so
the browser and Access can reach them. Keep the main Access app scoped to
`/admin*` only.

### Setup

1. Generate an RSA signing key and store it as a secret:
   ```
   npx tsx scripts/gen-oidc-key.ts | wrangler secret put OIDC_PRIVATE_JWK
   ```
2. Set the remaining secrets. Pick your own client ID and secret; they only
   have to match what you enter in Access next:
   ```
   wrangler secret put PUBLIC_BASE_URL        # e.g. https://partybot.example.com (https assumed)
   wrangler secret put ADMIN_SESSION_SECRET   # any long random string
   wrangler secret put OIDC_CLIENT_ID
   wrangler secret put OIDC_CLIENT_SECRET
   # optional: OIDC_EMAIL_DOMAIN (default "discord.local"), OIDC_REDIRECT_URI (override)
   ```
3. In Cloudflare Zero Trust → **Settings → Authentication → Login methods →
   Add new → OpenID Connect**:
   - **App ID** / **Client secret**: the `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`
     you chose
   - **Auth URL**: `https://<your-domain>/oidc/authorize`
   - **Token URL**: `https://<your-domain>/oidc/token`
   - **Certificate URL**: `https://<your-domain>/oidc/jwks`
   - Enable **PKCE**, save, then **Test**. It signs in cleanly once a session
     cookie exists.
4. On the Access application covering `/admin*`, add this OIDC provider as an
   allowed login method, keeping your email SSO method if you want both. The
   Worker's allow-list is the real gate, so a broad "allow everyone via this
   IdP" policy rule is fine.
5. Seed a magic-link admin for a guild. Super admins who sign in with an allowed
   email do not need seeding, since they can add magic-link admins from the UI:
   ```
   wrangler d1 execute partybot --remote --command \
     "INSERT INTO admin_users (guild_id, user_id, display_name, added_at) VALUES ('YOUR_GUILD_ID', 'YOUR_DISCORD_ID', 'You', unixepoch()*1000)"
   ```
6. Run `/party admin` in that guild and open the link.

Removing a user from a guild's allow-list cuts them off at their next Access
re-auth: `/oidc/authorize` re-checks the list even against a still-valid cookie.
All the login credentials are short-lived and swept by the existing cron.
