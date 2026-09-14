-- Approval is the bot's own record of who passed the quiz, and only that. The
-- optional Discord role that mirrored it is gone: it was a second copy of the
-- truth that could disagree with the first, and everything downstream reads the
-- database anyway.
--
-- Losing it also removes two states. 'granting' and 'revoking' existed solely to
-- remember that Discord still owed us a role change; with no role, passing the
-- quiz approves immediately and a revocation takes effect immediately.

-- Settle anything caught mid-flight before the states stop being legal.
UPDATE rules_members SET state = 'approved'   WHERE state = 'granting';
UPDATE rules_members SET state = 'unapproved' WHERE state = 'revoking';

CREATE TABLE rules_members_new (
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  state       TEXT    NOT NULL DEFAULT 'unapproved'
              CHECK (state IN ('unapproved', 'approved')),
  generation  INTEGER NOT NULL DEFAULT 0,
  revocations INTEGER NOT NULL DEFAULT 0,
  completions INTEGER NOT NULL DEFAULT 0,
  version     INTEGER,
  accepted_at INTEGER,
  revoked_at  INTEGER,
  PRIMARY KEY (guild_id, user_id)
);
INSERT INTO rules_members_new
  SELECT guild_id, user_id, state, generation, revocations, completions,
         version, accepted_at, revoked_at
  FROM rules_members;
DROP TABLE rules_members;
ALTER TABLE rules_members_new RENAME TO rules_members;
CREATE INDEX idx_rules_members_state ON rules_members (guild_id, state);

-- And the gate no longer holds a role.
CREATE TABLE rules_gate_new (
  guild_id         TEXT PRIMARY KEY,
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  default_required INTEGER NOT NULL DEFAULT 0 CHECK (default_required IN (0, 1)),
  channel_id       TEXT
);
INSERT INTO rules_gate_new (guild_id, enabled, default_required, channel_id)
  SELECT guild_id, enabled, default_required, channel_id FROM rules_gate;
DROP TABLE rules_gate;
ALTER TABLE rules_gate_new RENAME TO rules_gate;
