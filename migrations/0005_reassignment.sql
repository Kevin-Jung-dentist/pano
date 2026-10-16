-- Freeze completed quality checks once, so allocation does not rescan every answer.
CREATE TABLE game_round_quality(
 round_id TEXT PRIMARY KEY REFERENCES game_rounds(id) ON DELETE CASCADE,
 score REAL, reference_count INTEGER NOT NULL, eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
 quality_threshold REAL NOT NULL, rule_version TEXT NOT NULL, evaluated_at INTEGER NOT NULL
);
INSERT INTO game_round_quality(round_id,score,reference_count,eligible,quality_threshold,rule_version,evaluated_at)
SELECT round_id,score,COALESCE(reference_count,0),eligible,quality_threshold,rule_version,completed_at
FROM game_quality_audit;
CREATE TRIGGER game_freeze_round_quality AFTER UPDATE OF state ON game_rounds
WHEN NEW.state='complete' AND OLD.state<>'complete'
BEGIN
 INSERT INTO game_round_quality(round_id,score,reference_count,eligible,quality_threshold,rule_version,evaluated_at)
 SELECT round_id,score,COALESCE(reference_count,0),eligible,quality_threshold,rule_version,completed_at
 FROM game_quality_audit WHERE round_id=NEW.id;
END;
CREATE INDEX game_case_round_history ON game_round_cases(case_id,round_id);
CREATE INDEX game_quality_eligibility ON game_round_quality(eligible,round_id);
-- A claim is the current exclusive owner, not the whole assignment history.
CREATE UNIQUE INDEX game_one_case_claim ON game_claims(case_id);
DROP VIEW game_training_candidates;
CREATE VIEW game_training_candidates AS
SELECT rc.round_id,rc.case_id,rc.user_id,rc.submission_json AS boxes_json,rc.submitted_at,
 c.group_id,c.width,c.height,c.scope_json,c.source,c.object_key,
 q.score AS validation_score,q.quality_threshold,q.rule_version,
 'candidate_needs_review' AS review_state
FROM game_round_cases rc JOIN game_round_quality q ON q.round_id=rc.round_id
JOIN game_rounds r ON r.id=rc.round_id JOIN game_cases c ON c.id=rc.case_id
WHERE q.eligible=1 AND r.state='complete' AND r.rule_version='lod-score-2'
 AND q.rule_version=r.rule_version AND rc.kind='unscored' AND rc.submitted_at IS NOT NULL AND c.source='hanoi';