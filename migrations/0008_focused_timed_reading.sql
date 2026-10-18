-- AI context and human answers remain separate. Old rounds keep their old policy.
CREATE TABLE game_case_ai_context(
 case_id TEXT PRIMARY KEY REFERENCES game_cases(id),context_json TEXT NOT NULL,created_at INTEGER NOT NULL
);
ALTER TABLE game_round_cases ADD COLUMN label_scope_json TEXT;
ALTER TABLE game_round_cases ADD COLUMN ai_context_json TEXT;
ALTER TABLE game_round_cases ADD COLUMN started_at INTEGER;
ALTER TABLE game_round_cases ADD COLUMN deadline_at INTEGER;
ALTER TABLE game_round_cases ADD COLUMN auto_submitted INTEGER NOT NULL DEFAULT 0;

DROP VIEW game_quality_audit;
CREATE VIEW game_quality_audit AS
WITH scores AS (
 SELECT r.id AS round_id,r.user_id,r.rule_version,r.quality_threshold,r.completed_at,r.feedback_mode,
 SUM(json_extract(rc.grade_json,'$.reference_count')) AS reference_count,
 SUM(json_extract(rc.grade_json,'$.tp')) AS tp,SUM(json_extract(rc.grade_json,'$.fp')) AS fp,
 SUM(json_extract(rc.grade_json,'$.iou_sum')) AS iou_sum,
 CASE WHEN r.rule_version='lod-score-3' THEN
 MAX(0,MIN(100,100.0*(SUM(json_extract(rc.grade_json,'$.iou_sum'))-SUM(json_extract(rc.grade_json,'$.fp_penalty')))/SUM(json_extract(rc.grade_json,'$.reference_count'))))
 ELSE 100.0*SUM(json_extract(rc.grade_json,'$.iou_sum'))/(SUM(json_extract(rc.grade_json,'$.reference_count'))+SUM(json_extract(rc.grade_json,'$.fp'))) END AS score
 FROM game_rounds r JOIN game_round_cases rc ON rc.round_id=r.id
 WHERE r.state='complete' AND r.rule_version IN ('lod-score-2','lod-score-3') AND rc.kind='verified'
 GROUP BY r.id
)
SELECT *,CASE WHEN reference_count>0 AND score>=quality_threshold THEN 1 ELSE 0 END AS eligible FROM scores;

DROP VIEW game_training_candidates;
CREATE VIEW game_training_candidates AS
SELECT rc.round_id,rc.case_id,rc.user_id,rc.submission_json AS boxes_json,rc.submitted_at,
 c.group_id,c.width,c.height,COALESCE(rc.label_scope_json,c.scope_json) AS scope_json,c.source,c.object_key,
 q.score AS validation_score,q.quality_threshold,q.rule_version,rc.auto_submitted,
 CASE WHEN rc.auto_submitted=1 THEN 'partial' ELSE 'complete_for_scope' END AS coverage,
 rc.ai_context_json AS ai_context_json,'candidate_needs_review' AS review_state
FROM game_round_cases rc JOIN game_round_quality q ON q.round_id=rc.round_id
JOIN game_rounds r ON r.id=rc.round_id JOIN game_cases c ON c.id=rc.case_id
WHERE q.eligible=1 AND r.state='complete' AND r.rule_version IN ('lod-score-2','lod-score-3')
 AND q.rule_version=r.rule_version AND rc.kind='unscored' AND rc.submitted_at IS NOT NULL
 AND c.source='hanoi';
