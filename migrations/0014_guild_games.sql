-- Per-guild game lists. Games used to be one hardcoded catalog with an
-- allowlist per guild (empty = everything). Now there is a small built-in
-- catalog (League first), each guild can add its own custom games, and any
-- game can be switched off, so the allowlist becomes a list of disabled games.

ALTER TABLE guild_settings ADD COLUMN custom_games   TEXT NOT NULL DEFAULT '[]';  -- JSON string[]
ALTER TABLE guild_settings ADD COLUMN disabled_games TEXT NOT NULL DEFAULT '[]';  -- JSON string[]

-- Goose Goose Duck and Meccha Chameleon left the built-in catalog. Every guild
-- we know of could pick them until now, so give each one a settings row ...
INSERT OR IGNORE INTO guild_settings (guild_id)
  SELECT guild_id FROM parties
  UNION SELECT guild_id FROM templates
  UNION SELECT guild_id FROM party_history;

-- ... and keep them as custom games wherever they were allowed.
UPDATE guild_settings SET custom_games = (
  SELECT json_group_array(value) FROM json_each('["Goose Goose Duck","Meccha Chameleon"]')
  WHERE json_array_length(guild_settings.allowed_games) = 0
     OR value IN (SELECT value FROM json_each(guild_settings.allowed_games))
);

-- A non-empty allowlist turns into "every built-in not on it is disabled".
-- The catalog here is a snapshot of the built-ins as of this migration.
UPDATE guild_settings SET disabled_games = (
  SELECT json_group_array(value)
  FROM json_each('["LoL NA","LoL EUW","LoL PBE","Valorant","Overwatch","Starcraft 2","Other"]')
  WHERE value NOT IN (SELECT value FROM json_each(guild_settings.allowed_games))
)
WHERE json_array_length(allowed_games) > 0;

ALTER TABLE guild_settings DROP COLUMN allowed_games;
