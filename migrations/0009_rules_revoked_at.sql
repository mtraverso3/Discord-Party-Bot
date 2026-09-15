-- Admins skip the rules check, but a revocation has to mean something even for
-- them: being disciplined is not the same as not having got round to it yet.
--
-- The row could not tell those apart. `revocations` is a lifetime tally, so it
-- stays set after someone is revoked, passes again, and is approved — it says
-- nothing about why they are unapproved right now. This does: set when an
-- approval is taken away as discipline, cleared when they pass the check again
-- or when a moderator resets them without penalty.
ALTER TABLE rules_members ADD COLUMN revoked_at INTEGER;
