CREATE INDEX IF NOT EXISTS game_available_cases ON game_cases(active,kind);
CREATE INDEX IF NOT EXISTS game_claim_round ON game_claims(round_id);
