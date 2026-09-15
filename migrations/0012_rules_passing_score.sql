-- How much of the quiz a member has to get right, as a percentage.
--
-- Until now a wrong answer simply re-asked the same question, so every
-- completed check scored 100% and there was nothing to set. Questions are now
-- asked once each and graded at the end, and this is the bar. 100 keeps the
-- old outcome: every question right, or take it again.
ALTER TABLE rules_config ADD COLUMN passing_score INTEGER NOT NULL DEFAULT 100;

-- A run in flight carries its own tally: each question is asked once now, so
-- the count cannot be recovered from the step it is on.
ALTER TABLE rules_sessions ADD COLUMN correct INTEGER NOT NULL DEFAULT 0;
