-- What each player ended the game with: final items (item0..item6, empty slots
-- dropped) and, in Arena-style modes, their augments in pick order. JSON arrays
-- of Riot ids; NULL for rows stored before this column existed.
ALTER TABLE party_game_participants ADD COLUMN items    TEXT;
ALTER TABLE party_game_participants ADD COLUMN augments TEXT;

-- Fetch the stored games again so they pick the new columns up. A re-fetch that
-- fails keeps the participants it already has.
UPDATE party_games SET status = 'pending', next_attempt_at = 0
WHERE status = 'resolved';

-- League reference data the Worker builds itself on a cron, e.g. augment hover
-- text (see src/lib/augment-text.ts). One JSON blob per key.
CREATE TABLE IF NOT EXISTS lol_data (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);
