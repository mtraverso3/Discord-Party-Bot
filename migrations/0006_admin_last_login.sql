-- Track when each magic-link admin last established a session (clicked a valid
-- /party admin link). Not surfaced in the UI — kept for auditing/housekeeping.
-- NULL until the admin logs in for the first time after this migration.
ALTER TABLE admin_users ADD COLUMN last_login_at INTEGER;
