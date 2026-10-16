CREATE VIEW IF NOT EXISTS game_quality_audit AS
WITH scores AS (
 SELECT r.id AS round_id,r.user_id,r.rule_version,r.quality_threshold,r.completed_at,r.feedback_mode,
 SUM(json_extract(rc.grade_json,'$.reference_count')) AS reference_count,
 SUM(json_extract(rc.grade_json,'$.tp')) AS tp,SUM(json_extract(rc.grade_json,'$.fp')) AS fp,
 SUM(json_extract(rc.grade_json,'$.iou_sum')) AS iou_sum,
 100.0*SUM(json_extract(rc.grade_json,'$.iou_sum'))/
 (SUM(json_extract(rc.grade_json,'$.reference_count'))+SUM(json_extract(rc.grade_json,'$.fp'))) AS score
 FROM game_rounds r JOIN game_round_cases rc ON rc.round_id=r.id
 WHERE r.state='complete' AND r.rule_version='lod-score-2' AND rc.kind='verified'
 GROUP BY r.id
)
SELECT *,CASE WHEN reference_count>0 AND score>=quality_threshold THEN 1 ELSE 0 END AS eligible FROM scores;
CREATE VIEW IF NOT EXISTS game_training_candidates AS
SELECT rc.round_id,rc.case_id,rc.user_id,rc.submission_json AS boxes_json,rc.submitted_at,
 c.group_id,c.width,c.height,c.scope_json,c.source,c.object_key,
 a.score AS validation_score,a.quality_threshold,a.rule_version,
 'candidate_needs_review' AS review_state
FROM game_round_cases rc JOIN game_quality_audit a ON a.round_id=rc.round_id
JOIN game_cases c ON c.id=rc.case_id
WHERE a.eligible=1 AND rc.kind='unscored' AND rc.submitted_at IS NOT NULL AND c.source='hanoi';
