import test from 'node:test';
import assert from 'node:assert/strict';
import Game from '../dist/game-core.js';
import {harness,ref} from './game-harness.mjs';
import {handle} from '../server/api.mjs';
import {now} from '../server/auth.mjs';
const call=async(h,path,body,who='alice')=>{const res=await handle(h.req(path,body,who),h.env);return {status:res.status,body:await res.json()};};
const box=(id,category='caries_ungraded',bbox=[0,0,10,10])=>({id,category,geometry:Game.geometry[category],bbox});
const im={width:1200,height:650};
const start=async h=>(await call(h,'rounds',{})).body;
const open=(h,r,c)=>call(h,`rounds/${r.id}/cases/${c.id}/begin`,{});
const submit=(h,r,c,boxes=ref,revision=0)=>call(h,`rounds/${r.id}/cases/${c.id}/submit`,{boxes,revision});
const expire=(h,r,c)=>h.DB.db.prepare('UPDATE game_round_cases SET deadline_at=? WHERE round_id=? AND case_id=?').run(now()-1,r.id,c.id);

test('one extra caries box has one quarter the penalty of one missed exact finding; periapical extras retain full penalty',()=>{
 const perfect=Game.grade(ref,ref,im),miss=Game.grade([ref[0]],ref,im);
 const extra=Game.grade([...ref,box('extra')],ref,im),peri=Game.grade([...ref,box('extra','periapical_lesion')],ref,im);
 assert.equal(perfect.score,100);assert.equal(miss.score,50);assert.equal(extra.score,87.5);assert.equal(peri.score,50);
 assert.equal(100-extra.score,(100-miss.score)/4);assert.equal(extra.fp_penalty,.25);
 assert.equal(Game.grade(Array.from({length:40},(_,i)=>box('x'+i)),ref,im).score,0);
 assert.equal(Game.gradeV2([...ref,box('extra')],ref,im).score,200/3);
});

test('new rounds expose only human drafts, retain verified deep-caries references privately, and never copy AI hints',async()=>{
 const h=await harness(),ai={schema:'lod-ai-context-v1',origin:'ai_prediction',review_state:'unverified',version:'fixture',boxes:[box('ai1','deep_caries'),box('ai2','impacted_tooth',[20,20,30,30])]};
 h.DB.db.prepare('UPDATE game_cases SET reference_json=? WHERE kind=?').run(JSON.stringify([...ref,box('gold-deep','deep_caries')]),'verified');
 for(const c of h.DB.db.prepare('SELECT id FROM game_cases').all())h.DB.db.prepare('INSERT INTO game_case_ai_context VALUES(?,?,?)').run(c.id,JSON.stringify(ai),now());
 let r=await start(h);assert.equal(r.case_seconds,120);assert.ok(r.items.every(c=>JSON.stringify(c.scope)===JSON.stringify(Game.labelCategories)&&!('ai_context' in c)));
 h.DB.db.exec("UPDATE game_case_ai_context SET context_json='{}'");
 r=(await open(h,r,r.items[0])).body;const c=r.items[0];assert.ok(!('ai_context' in c));assert.deepEqual(c.boxes,[]);assert.ok(!JSON.stringify(r).includes('gold-deep'));assert.ok(!JSON.stringify(r).includes('ai1'));
 assert.equal((await submit(h,r,c,[box('bad','deep_caries')])).status,400);
 const snap=h.DB.db.prepare("SELECT reference_json,ai_context_json FROM game_round_cases WHERE round_id=? AND kind='verified'").all(r.id);assert.ok(snap.every(c=>JSON.parse(c.reference_json).length===3&&c.ai_context_json===null));
});

test('two-minute timer cannot be reset by reload, repeated begin or client timestamps; future images and edits require sequential opening',async()=>{
 const h=await harness();let r=await start(h);const first=r.items[0],second=r.items[1];
 assert.equal((await submit(h,r,first)).status,409);assert.equal((await open(h,r,second)).status,409);
 const begin=await open(h,r,first);r=begin.body;assert.equal(r.items[0].deadline_at-r.items[0].started_at,120);
 const deadline=r.items[0].deadline_at;
 for(const path of ['rounds/'+r.id,`rounds/${r.id}/cases/${first.id}/begin`]){
  const read=await call(h,path,path.endsWith('begin')?{deadline_at:9999999999}:undefined);assert.equal(read.body.items[0].deadline_at,deadline);
 }
 assert.equal((await call(h,`rounds/${r.id}/cases/${first.id}/begin`,{},'bob')).status,404);
 const response=await handle(h.req('images/'+second.id+'?round='+r.id),h.env);assert.equal(response.status,404);
});

test('expired answers submit the last server draft exactly once and reject late edits without starting another timer',async()=>{
 const h=await harness();let r=await start(h),c=r.items[0];await open(h,r,c);
 assert.equal((await call(h,`rounds/${r.id}/cases/${c.id}/draft`,{boxes:[ref[0]],revision:0})).status,200);
 expire(h,r,c);
 r=(await submit(h,r,c,ref,1)).body;
 assert.equal(r.items[0].auto_submitted,true);assert.deepEqual(r.items[0].boxes,Game.boxes([ref[0]],im));assert.equal(r.items[0].revision,2);assert.equal(r.items[1].started_at,null);
 const again=(await submit(h,r,c,[],0)).body;assert.equal(again.items[0].revision,2);assert.deepEqual(again.items[0].boxes,r.items[0].boxes);
 assert.equal((await call(h,`rounds/${r.id}/cases/${c.id}/draft`,{boxes:ref,revision:2})).status,409);
 await open(h,r,r.items[1]);assert.ok((await call(h,'rounds/'+r.id)).body.items[1].deadline_at>now());
});

test('reopening expires a disconnected case; passing timeout labels remain explicit partial training candidates',async()=>{
 const h=await harness();let r=await start(h);
 for(const c of r.items){
  await open(h,r,c);
  await call(h,`rounds/${r.id}/cases/${c.id}/draft`,{boxes:ref,revision:0});expire(h,r,c);
  r=(await call(h,'rounds/'+r.id)).body;
 }
 assert.equal(r.state,'complete');assert.equal(r.result.score,100);assert.ok(r.items.every(c=>c.auto_submitted));
 const rows=h.DB.db.prepare('SELECT * FROM game_training_candidates').all();assert.equal(rows.length,7);assert.ok(rows.every(x=>x.auto_submitted===1&&x.coverage==='partial'&&JSON.stringify(JSON.parse(x.scope_json))===JSON.stringify(Game.labelCategories)));
 assert.equal(h.DB.db.prepare('SELECT COUNT(*) n FROM game_round_quality').get().n,1);
 const own=(await call(h,'me/ranking')).body;assert.equal(own.points,10);assert.equal(own.average,100);
 assert.equal(h.DB.db.prepare('SELECT score FROM game_quality_audit').get().score,100);
});

test('weighted scoring agrees across result, leaderboard and frozen training qualification',async()=>{
 const h=await harness();let r=await start(h);
 for(const c of r.items){await open(h,r,c);r=(await submit(h,r,c,[...ref,box('extra')])).body;}
 assert.equal(r.result.score,87.5);assert.equal((await call(h,'me/ranking')).body.average,87.5);
 assert.equal(h.DB.db.prepare('SELECT score FROM game_round_quality').get().score,87.5);
 assert.equal(h.DB.db.prepare('SELECT validation_score FROM game_training_candidates').get().validation_score,87.5);
});

test('previous scoring rounds retain their saved rule without a new time limit',async()=>{
 const h=await harness();let r=await start(h);h.DB.db.prepare('UPDATE game_rounds SET rule_version=? WHERE id=?').run(Game.previousVersion,r.id);
 for(const c of r.items)r=(await submit(h,r,c,[...ref,box('extra')])).body;
 assert.equal(r.case_seconds,null);assert.equal(r.result.score,200/3);assert.equal(r.result.legacy,false);
 assert.ok(Math.abs((await call(h,'me/ranking')).body.average-200/3)<1e-9);
});

test('failed previous-version sets can be reassigned only after the fresh pool is exhausted',async()=>{
 const h=await harness();h.DB.db.exec("UPDATE game_cases SET active=0 WHERE kind='unscored' AND CAST(substr(id,5) AS INTEGER)>=28");
 let r=await start(h);h.DB.db.prepare('UPDATE game_rounds SET rule_version=? WHERE id=?').run(Game.previousVersion,r.id);
 for(const c of r.items)r=(await submit(h,r,c,[])).body;
 const next=await call(h,'rounds',{},'bob');assert.equal(next.status,200);assert.equal(next.body.rule_version,Game.version);
 const ids=x=>x.items.filter(c=>Number(c.id.slice(4))>=21).map(c=>c.id).sort();assert.deepEqual(ids(next.body),ids(r));
});
