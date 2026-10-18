import Game from '../dist/game-core.js';
import {publicEntries,PUBLIC_RANK_LIMIT} from './public-ranking.mjs';

export const roundScores=`WITH round_scores AS (
 SELECT r.id,r.user_id,r.country,r.university,r.university_key,r.total_target AS questions,
 SUM(json_extract(rc.grade_json,'$.tp')) tp,SUM(json_extract(rc.grade_json,'$.fp')) fp,
 SUM(json_extract(rc.grade_json,'$.reference_count')) reference_count,
 CASE WHEN r.rule_version='lod-score-3' THEN
 MAX(0,MIN(100,100.0*(SUM(json_extract(rc.grade_json,'$.iou_sum'))-SUM(json_extract(rc.grade_json,'$.fp_penalty')))/SUM(json_extract(rc.grade_json,'$.reference_count'))))
 ELSE 100.0*SUM(json_extract(rc.grade_json,'$.iou_sum'))/
 (SUM(json_extract(rc.grade_json,'$.reference_count'))+SUM(json_extract(rc.grade_json,'$.fp'))) END score
 FROM game_rounds r JOIN game_round_cases rc ON rc.round_id=r.id
 WHERE r.state='complete' AND r.rule_version IN ('lod-score-2',?) AND rc.kind='verified'
 GROUP BY r.id HAVING SUM(json_extract(rc.grade_json,'$.reference_count'))>0)`;

// Rank before the public limit and before masking names. The private card and
// public table use exactly the same ordering, including deterministic tie breaks.
const individualScores=roundScores+`, real_scores AS (
 SELECT u.id AS user_id,u.nickname AS name,u.country,u.university,
 SUM(r.score*r.questions)/SUM(r.questions) AS average,
 SUM(r.score*r.questions/100.0) AS points,SUM(r.questions) AS questions,COUNT(*) AS rounds
 FROM round_scores r JOIN game_users u ON u.id=r.user_id
 WHERE NOT EXISTS(SELECT 1 FROM game_admins a WHERE a.user_id=u.id)
 GROUP BY u.id
), league AS (
 SELECT 'real:'||user_id AS row_id,user_id,name,country,university,average,points,questions,rounds,0 AS is_demo FROM real_scores
 UNION ALL
 SELECT 'demo:'||id,NULL,nickname,country,university,average,average*rounds*10/100.0,rounds*10,rounds,1 FROM game_demo_leaders
), ranked AS (
 SELECT *,ROW_NUMBER() OVER(ORDER BY points DESC,average DESC,questions DESC,name COLLATE NOCASE,country,row_id) AS rank FROM league
)`;

export async function individualLeaderboard(db){
 const {results}=await db.prepare(individualScores+` SELECT name,country,university,average,points,questions,rounds,is_demo,rank FROM ranked ORDER BY rank LIMIT ${PUBLIC_RANK_LIMIT}`).bind(Game.version).all();
 const rows=results.map(r=>({...r,is_demo:!!r.is_demo,members:1}));
 return {entries:publicEntries(rows.filter(r=>!r.is_demo),'individual'),demo_entries:publicEntries(rows.filter(r=>r.is_demo),'individual')};
}

export async function personalRanking(db,user){
 const row=await db.prepare(individualScores+' SELECT rank,points,questions,average,rounds FROM ranked WHERE user_id=?').bind(Game.version,user.id).first();
 if(row)return {...row,nickname:user.nickname,state:'ranked'};
 const own=await db.prepare(roundScores+` SELECT SUM(score*questions/100.0) points,SUM(questions) questions,SUM(score*questions)/SUM(questions) average,COUNT(*) rounds FROM round_scores WHERE user_id=?`).bind(Game.version,user.id).first();
 const admin=await db.prepare('SELECT user_id FROM game_admins WHERE user_id=?').bind(user.id).first();
 return {nickname:user.nickname,rank:null,points:own.points??0,questions:own.questions??0,average:own.average,rounds:own.rounds,state:admin?'excluded':'unranked'};
}
