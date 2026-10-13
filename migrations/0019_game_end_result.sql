-- How Riot says the game ended, e.g. 'GameComplete' or 'Abort_TooFewPlayers'
-- (a lobby where not everyone loaded in). Aborted games have no winner and put
-- everyone on one team, so the dashboard shows them apart.
ALTER TABLE party_games ADD COLUMN end_result TEXT;

-- Fetch stored games again to fill it in. Games 0018 already queued are still
-- pending and pick it up on their way through.
UPDATE party_games SET status = 'pending', next_attempt_at = 0
WHERE status = 'resolved';
