-- PartyBot D1 schema — the single source of truth for all bot state.
--
-- Concurrency notes: D1 serializes writes per database and `db.batch()` runs
-- as one transaction, so cross-table invariants are enforced with constraints
-- and guarded statements rather than an external lock:
--   * "a user is in at most one party per guild" is the party_members primary
--     key (guild_id, user_id) — concurrent joins/creates can't violate it.
--   * capacity checks are re-verified inside the INSERT/UPDATE statements
--     themselves, so a stale read can't oversubscribe a party.

CREATE TABLE parties (
  guild_id         TEXT    NOT NULL,
  id               TEXT    NOT NULL,   -- short public ID, e.g. "A1B2C3"
  name             TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  game             TEXT    NOT NULL DEFAULT 'Other',
  owner_id         TEXT    NOT NULL,
  max_size         INTEGER NOT NULL,
  voice_channel_id TEXT,
  is_closed        INTEGER NOT NULL DEFAULT 0,
  embed_message_id TEXT,
  embed_channel_id TEXT,
  created_at       INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, id)
);
CREATE INDEX idx_parties_activity ON parties (last_activity_at);

-- Members and queued users live in one table split by `role`. `position` is a
-- per-party monotonic counter used for queue ordering; members display in
-- joined_at order so queue promotions land at the bottom of the list.
CREATE TABLE party_members (
  guild_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  party_id     TEXT    NOT NULL,
  role         TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'queued')),
  username     TEXT    NOT NULL DEFAULT '',
  display_name TEXT    NOT NULL DEFAULT '',
  ign          TEXT,
  away         INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL,
  joined_at    INTEGER NOT NULL,
  queued_at    INTEGER,
  PRIMARY KEY (guild_id, user_id),
  FOREIGN KEY (guild_id, party_id) REFERENCES parties (guild_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_members_party ON party_members (guild_id, party_id, role, position);

-- Per-party banlist. `idx` preserves the order the owner pasted the list in;
-- `pool_order` is the FIFO order of unassigned bans (NULL while assigned,
-- re-appended at the back when a member leaves and frees their ban).
CREATE TABLE party_bans (
  guild_id    TEXT    NOT NULL,
  party_id    TEXT    NOT NULL,
  idx         INTEGER NOT NULL,
  value       TEXT    NOT NULL,
  assigned_to TEXT,
  pool_order  INTEGER,
  PRIMARY KEY (guild_id, party_id, idx),
  FOREIGN KEY (guild_id, party_id) REFERENCES parties (guild_id, id) ON DELETE CASCADE
);

-- Per-user, per-game in-game names. norm_name/norm_tag hold the normalized
-- "Name#Tag" parts for the reverse Riot-ID lookup used by the desktop client
-- (norm_tag is '' when the user registered without a tagline = wildcard).
CREATE TABLE user_igns (
  user_id   TEXT NOT NULL,
  game      TEXT NOT NULL,
  ign       TEXT NOT NULL,
  norm_name TEXT,
  norm_tag  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, game)
);
CREATE INDEX idx_igns_riot ON user_igns (game, norm_name, norm_tag);

CREATE TABLE guild_settings (
  guild_id        TEXT PRIMARY KEY,
  max_parties     INTEGER NOT NULL DEFAULT 10,
  default_cap     INTEGER NOT NULL DEFAULT 10,
  allowed_games   TEXT    NOT NULL DEFAULT '[]',  -- JSON string[]
  client_inviters TEXT    NOT NULL DEFAULT '[]',  -- JSON string[]
  party_bumpers   TEXT    NOT NULL DEFAULT '[]'   -- JSON string[]
);

CREATE TABLE templates (
  guild_id         TEXT    NOT NULL,
  id               TEXT    NOT NULL,
  label            TEXT    NOT NULL,
  name             TEXT    NOT NULL DEFAULT '',
  description      TEXT    NOT NULL DEFAULT '',
  game             TEXT    NOT NULL DEFAULT 'Other',
  max_size         INTEGER NOT NULL,
  voice_channel_id TEXT,
  banlist          TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (guild_id, id)
);

CREATE TABLE audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
  email    TEXT,
  method   TEXT    NOT NULL,
  path     TEXT    NOT NULL
);
CREATE INDEX idx_audit_guild ON audit_log (guild_id, id DESC);

-- Short-lived one-time codes from /party link, exchanged for client tokens.
CREATE TABLE link_codes (
  code         TEXT PRIMARY KEY,
  guild_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- Long-lived desktop-client bearer tokens with a sliding expiry.
CREATE TABLE client_tokens (
  token        TEXT PRIMARY KEY,
  user_id      TEXT    NOT NULL,
  guild_id     TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  refreshed_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
