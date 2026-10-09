-- Bot-wide switches set from outside the Worker, e.g. by the Deploy workflow.
-- maintenance_until: epoch ms until which PartyBot answers "updating, try again".
CREATE TABLE IF NOT EXISTS system_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
