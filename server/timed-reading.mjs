import Game from '../dist/game-core.js';
import {now} from './auth.mjs';
const error=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const timed=round=>round.rule_version===Game.version;
export const scopeFor=c=>JSON.parse(c.label_scope_json||c.scope_json);
export async function caseRecord(db,rid,cid){
 return db.prepare('SELECT rc.*,c.width,c.height,c.scope_json FROM game_round_cases rc JOIN game_cases c ON c.id=rc.case_id WHERE round_id=? AND case_id=?').bind(rid,cid).first();
}
export async function finishCase(db,round,c,boxes,automatic=false){
 const timestamp=now(),grade=c.kind==='verified'?Game.gradeFor(round.rule_version,boxes,JSON.parse(c.reference_json),{...c,scope:scopeFor(c)}):null;
 const answer=JSON.stringify(boxes);
 const guard=timed(round)?automatic?' AND deadline_at<=?':' AND started_at IS NOT NULL AND deadline_at>?':'';
 const params=[answer,answer,timestamp,grade?JSON.stringify(grade):null,grade?.points??null,automatic?1:0,round.id,c.case_id,c.revision];
 if(timed(round))params.push(timestamp);
 const result=await db.batch([
 db.prepare('UPDATE game_round_cases SET submission_json=?,draft_json=?,submitted_at=?,revision=revision+1,grade_json=?,points=?,auto_submitted=? WHERE round_id=? AND case_id=? AND revision=? AND submitted_at IS NULL'+guard).bind(...params),
 db.prepare("UPDATE game_rounds SET state='complete',completed_at=? WHERE id=? AND state='active' AND (SELECT COUNT(*) FROM game_round_cases WHERE round_id=? AND submitted_at IS NOT NULL)=total_target").bind(timestamp,round.id,round.id)
 ]);
 return !!result[0].meta.changes;
}
export async function expireDue(db,round){
 if(!timed(round)||round.state!=='active')return;
 for(let retry=0;retry<4;retry++){
  const c=await db.prepare('SELECT rc.*,c.width,c.height,c.scope_json FROM game_round_cases rc JOIN game_cases c ON c.id=rc.case_id WHERE round_id=? AND submitted_at IS NULL AND deadline_at<=? ORDER BY position LIMIT 1').bind(round.id,now()).first();
  if(!c)return;
  const boxes=Game.boxes(JSON.parse(c.draft_json),{...c,scope:scopeFor(c)});
  if(await finishCase(db,round,c,boxes,true))return;
 }
 error(409,'caseSyncRetry');
}
export async function beginCase(db,round,cid){
 await expireDue(db,round);
 if(!timed(round))return;
 const c=await caseRecord(db,round.id,cid);if(!c)error(404,'배정되지 않은 영상입니다.');
 if(c.submitted_at)return;
 const next=await db.prepare('SELECT case_id FROM game_round_cases WHERE round_id=? AND submitted_at IS NULL ORDER BY position LIMIT 1').bind(round.id).first();
 if(next?.case_id!==cid)error(409,'caseOutOfOrder');
 const timestamp=now();
 await db.prepare('UPDATE game_round_cases SET started_at=?,deadline_at=? WHERE round_id=? AND case_id=? AND started_at IS NULL AND submitted_at IS NULL AND position=(SELECT MIN(position) FROM game_round_cases WHERE round_id=? AND submitted_at IS NULL)').bind(timestamp,timestamp+Game.caseSeconds,round.id,cid,round.id).run();
}
