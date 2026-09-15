-- The rules check moves into this Worker. It used to be a second Discord
-- application: a Python bot holding a gateway connection, its own SQLite file,
-- and an HTTP admin service the Worker called over a tunnel. None of that can
-- run on Workers, so the state it owned lives here now and one bot serves both
-- the queue and verification.
--
-- Everything is per guild, unlike the single-server Python deployment.

-- Panel-managed rules text and quiz. One row per guild; absent means the guild
-- has never published, and the defaults in lib/rules-content.ts apply.
CREATE TABLE rules_config (
  guild_id   TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  pages      TEXT    NOT NULL,          -- JSON [{title, text}]
  questions  TEXT    NOT NULL,          -- JSON [{text, correct[], incorrect[], explanation}]
  agreement  TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- Who has passed. This replaces the Python bot's members table, and is what
-- the party gate consults instead of reading a Discord role.
--   'unapproved' nothing in progress · 'approved' passed and current
--   'revoking'   approval withdrawn, a configured role still to be removed
--   'granting'   passed, a configured role still to be added
CREATE TABLE rules_members (
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  state       TEXT    NOT NULL DEFAULT 'unapproved'
              CHECK (state IN ('unapproved', 'granting', 'approved', 'revoking')),
  -- Bumped by every revocation or reset, so a quiz in flight can detect that
  -- it is stale without any cross-request locking.
  generation  INTEGER NOT NULL DEFAULT 0,
  revocations INTEGER NOT NULL DEFAULT 0,   -- lifetime disciplinary count
  completions INTEGER NOT NULL DEFAULT 0,
  version     INTEGER,                      -- rules version they agreed to
  accepted_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_rules_members_state ON rules_members (guild_id, state);

CREATE TABLE rules_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL,   -- verified | revoked | reset
  actor      TEXT,               -- admin identity, or NULL when automatic
  reason     TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rules_events_member ON rules_events (guild_id, user_id, id DESC);

-- A quiz in progress. The Python bot kept these in memory and lost them on
-- restart; a Worker has no memory between requests, so they live here and
-- survive a deploy. One per member: starting again replaces the old one.
CREATE TABLE rules_sessions (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  page       INTEGER NOT NULL DEFAULT 0,
  question   INTEGER NOT NULL DEFAULT 0,
  step       INTEGER NOT NULL DEFAULT 0,  -- ignores clicks from a stale render
  generation INTEGER NOT NULL,
  version    INTEGER NOT NULL,
  -- The shuffled answers as shown, so grading matches the buttons on screen.
  answers    TEXT    NOT NULL DEFAULT '[]',
  feedback   TEXT    NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- rules_gate held the approval role the panel connected to, and required one.
-- Approval is ours now, so a role is optional — set one only to mirror approval
-- into Discord for other integrations. SQLite cannot relax NOT NULL in place,
-- so the table is rebuilt and the existing rows carried over.
CREATE TABLE rules_gate_new (
  guild_id   TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  role_id    TEXT,   -- optional: approval is also reflected by this Discord role
  channel_id TEXT    -- where /rules-post puts the Start button
);
INSERT INTO rules_gate_new (guild_id, enabled, role_id)
  SELECT guild_id, enabled, role_id FROM rules_gate;
DROP TABLE rules_gate;
ALTER TABLE rules_gate_new RENAME TO rules_gate;
