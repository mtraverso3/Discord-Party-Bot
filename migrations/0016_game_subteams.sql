-- Arena-style modes put players in many small teams and rank them, so blue/red
-- and win/loss can't describe them. Keep each player's subteam and placement.
ALTER TABLE party_game_participants ADD COLUMN subteam   INTEGER;
ALTER TABLE party_game_participants ADD COLUMN placement INTEGER;

-- Fetch again the games already stored that weren't a plain 5v5, so they pick
-- the new columns up. The resolver rewrites their participants.
UPDATE party_games SET status = 'pending', next_attempt_at = 0
WHERE status = 'resolved' AND (
  queue_id >= 1700
  OR id IN (
    SELECT game_row_id FROM party_game_participants
    GROUP BY game_row_id
    HAVING COUNT(*) <> 10 OR SUM(team_id NOT IN (100, 200)) > 0
  )
);
