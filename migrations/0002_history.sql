-- Party history + League game reporting.
--
-- Parties are ephemeral (a row in `parties` is deleted on disband/sweep), so
-- their history lives in its own tables that outlive the party. One party
-- lifetime = one `party_history` row (the "session"); `party_history_events`
-- is the append-only log of who went in and out and what changed; `party_games`
-- records League matches the desktop client reported for that session.

-- One row per party lifetime. `party_id` is the short public ID at the time,
-- which is recycled after a party is disbanded, so the surrogate `history_id`
-- is the stable key. At most one row per (guild_id, party_id) has ended_at NULL
-- at a time — that's the "active" session events attach to.
CREATE TABLE party_history (
  history_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  party_id    TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  game        TEXT    NOT NULL DEFAULT 'Other',
  owner_id    TEXT    NOT NULL,
  owner_name  TEXT    NOT NULL DEFAULT '',
  max_size    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  ended_at    INTEGER,          -- NULL while the party is still live
  end_reason  TEXT              -- 'disbanded' | 'cleared' | 'inactive 6h' | ...
);
CREATE INDEX idx_party_history_guild ON party_history (guild_id, history_id DESC);
-- Lookup for the active session of a party (the ORDER BY resolves any stale
-- rows a crash could theoretically leave, newest wins).
CREATE INDEX idx_party_history_active ON party_history (guild_id, party_id, ended_at);

-- Append-only event log for a session: created, joined, queued, left, dequeued,
-- promoted, approved, denied, owner_changed, closed, opened, game_changed,
-- banlist_set, disbanded. `detail` is optional JSON with extra context.
CREATE TABLE party_history_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  history_id   INTEGER NOT NULL,
  ts           INTEGER NOT NULL,
  event        TEXT    NOT NULL,
  user_id      TEXT,             -- the subject user (joiner/leaver/…), when applicable
  display_name TEXT,
  detail       TEXT,             -- JSON blob, e.g. {"reason":"..."} or {"from":"X","to":"Y"}
  FOREIGN KEY (history_id) REFERENCES party_history (history_id) ON DELETE CASCADE
);
CREATE INDEX idx_party_history_events ON party_history_events (history_id, id);

-- A League match reported by the desktop client while the party was live. Rows
-- start `pending` (the match isn't queryable from Riot until the game ends) and
-- a cron sweep resolves them via match-v5, filling in the participants below.
CREATE TABLE party_games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  history_id    INTEGER NOT NULL,
  guild_id      TEXT    NOT NULL,
  party_id      TEXT    NOT NULL,
  match_id      TEXT    NOT NULL,  -- '{PLATFORM}_{gameId}', e.g. 'NA1_4812345678'
  platform      TEXT    NOT NULL,  -- routing platform, e.g. 'na1'
  region        TEXT,              -- short region code as the client saw it, e.g. 'NA'
  game_id       TEXT    NOT NULL,  -- numeric gameId as a string
  reported_by   TEXT    NOT NULL,  -- discord user id of the reporting client
  reported_at   INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending',  -- 'pending' | 'resolved' | 'failed'
  attempts      INTEGER NOT NULL DEFAULT 0,
  resolved_at   INTEGER,
  queue_id      INTEGER,
  game_creation INTEGER,
  game_duration INTEGER,
  error         TEXT,
  FOREIGN KEY (history_id) REFERENCES party_history (history_id) ON DELETE CASCADE
);
-- One report per match per session (a match can be reported by several clients).
CREATE UNIQUE INDEX idx_party_games_match ON party_games (history_id, match_id);
CREATE INDEX idx_party_games_history ON party_games (history_id, id);
CREATE INDEX idx_party_games_status ON party_games (status);

CREATE TABLE party_game_participants (
  game_row_id   INTEGER NOT NULL,  -- party_games.id
  puuid         TEXT    NOT NULL,
  riot_id       TEXT    NOT NULL DEFAULT '',  -- 'gameName#tagLine'
  champion_id   INTEGER NOT NULL,
  champion_name TEXT    NOT NULL DEFAULT '',
  team_id       INTEGER NOT NULL,
  win           INTEGER,           -- 1 win / 0 loss / NULL unknown
  PRIMARY KEY (game_row_id, puuid),
  FOREIGN KEY (game_row_id) REFERENCES party_games (id) ON DELETE CASCADE
);
