-- Admin notes about users.
--
-- Free-text notes an admin can attach to a member from the Users page — e.g.
-- "smurf of X", "warned for toxicity", "prefers jungle". Guild-scoped like the
-- rest of the admin panel: the same Discord user can have separate notes in
-- separate servers. Attributed to the acting admin's Access email, same as the
-- audit log.
CREATE TABLE user_notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  author_email TEXT,             -- the admin who wrote it, when known
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_user_notes ON user_notes (guild_id, user_id, id DESC);
