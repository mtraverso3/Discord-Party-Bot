-- Pending game reports retry with backoff instead of every sweep, so reports
-- Match-v5 never returns (custom games) stop crowding out the rest.
ALTER TABLE party_games ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_party_games_due ON party_games (status, next_attempt_at);
