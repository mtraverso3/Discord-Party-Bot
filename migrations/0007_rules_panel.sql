CREATE TABLE IF NOT EXISTS rules_gate (
  guild_id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);
