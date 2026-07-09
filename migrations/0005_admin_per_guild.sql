-- Per-guild magic-link admins.
--
-- Previously the `admin_users` allow-list (and the magic-link session it grants)
-- was global: a Discord user added anywhere could sign in and see every guild.
-- Now magic-link admin access is scoped to the guild whose `/party admin`
-- minted the link. Super admins (Cloudflare Access via a real email) are not in
-- this table and still see every guild.
--
-- The old allow-list can't be migrated automatically — there's no guild to
-- attribute existing rows to — so the table is recreated empty. Re-add
-- magic-link admins per guild from the admin UI's Admins page (or re-seed with
-- `wrangler d1 execute`, now including a guild_id; see the README).

DROP TABLE admin_users;
CREATE TABLE admin_users (
  guild_id     TEXT    NOT NULL,       -- guild this admin can manage
  user_id      TEXT    NOT NULL,       -- Discord user ID
  display_name TEXT    NOT NULL DEFAULT '',
  added_by     TEXT,                   -- identity that added them (email or "<id>@<guild>.discord…")
  added_at     INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- Magic-link tokens and OIDC codes now carry the guild the login is scoped to,
-- so the session cookie and the OIDC identity stay pinned to that one guild.
-- Both are single-use and short-lived (swept by cron), so any pre-migration
-- rows simply expire with an empty guild.
ALTER TABLE admin_link_tokens ADD COLUMN guild_id TEXT NOT NULL DEFAULT '';
ALTER TABLE oidc_codes        ADD COLUMN guild_id TEXT NOT NULL DEFAULT '';
