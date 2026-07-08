-- Discord-identity admin login.
--
-- Lets manually allow-listed Discord users reach the /admin UI without an email
-- SSO login. `/party admin` mints a single-use magic link; clicking it sets a
-- 24h browser session, which the Worker's built-in OIDC provider turns into a
-- Cloudflare Access identity (see src/auth/). Email SSO still works alongside.

-- Discord users allowed to reach /admin (manually curated in the Admins page).
CREATE TABLE admin_users (
  user_id      TEXT    PRIMARY KEY,   -- Discord user ID
  display_name TEXT    NOT NULL DEFAULT '',
  added_by     TEXT,                  -- identity that added them (email or "<id>@discord…")
  added_at     INTEGER NOT NULL
);

-- Single-use magic-link tokens from /party admin. Consumed on first click,
-- which establishes the 24h admin session cookie.
CREATE TABLE admin_link_tokens (
  token        TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL,
  display_name TEXT    NOT NULL DEFAULT '',
  expires_at   INTEGER NOT NULL
);

-- Short-lived OIDC authorization codes minted for Cloudflare Access during the
-- login redirect, exchanged once at the token endpoint (single use).
CREATE TABLE oidc_codes (
  code           TEXT    PRIMARY KEY,
  user_id        TEXT    NOT NULL,
  display_name   TEXT    NOT NULL DEFAULT '',
  nonce          TEXT,
  code_challenge TEXT,
  redirect_uri   TEXT    NOT NULL,
  expires_at     INTEGER NOT NULL
);
