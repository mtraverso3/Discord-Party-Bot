-- The rules check is opt-in per party, not blanket per server. rules_gate says
-- whether the server has a check at all; this says which parties enforce it, so
-- open pick-up games and verified customs can run side by side.
--
-- Existing parties and templates default to 0: turning the server switch on
-- gates nothing until a party asks for it.
ALTER TABLE parties ADD COLUMN rules_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE templates ADD COLUMN rules_required INTEGER NOT NULL DEFAULT 0;

-- What a newly created party gets when nobody says either way. Off keeps the
-- server's existing behaviour; on means "everything is gated unless excused",
-- which is what a server coming from the blanket gate wants.
ALTER TABLE rules_gate ADD COLUMN default_required INTEGER NOT NULL DEFAULT 0;
