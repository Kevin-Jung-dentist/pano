ALTER TABLE game_users ADD COLUMN feedback_plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE game_rounds ADD COLUMN feedback_mode TEXT NOT NULL DEFAULT 'free';
ALTER TABLE game_rounds ADD COLUMN quality_threshold REAL NOT NULL DEFAULT 50;
CREATE INDEX IF NOT EXISTS game_claimed_case ON game_claims(case_id);
