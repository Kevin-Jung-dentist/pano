import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,ref} from './game-harness.mjs';
import {handle} from '../server/api.mjs';
import * as Auth from '../server/auth.mjs';
async function call(h,path,body,who='alice'){const res=await handle(h.req(path,body,who),h.env);return {status:res.status,body:await res.json()};}
async function reader(h,id){const now=Auth.now(),token=Auth.random();h.tokens[id]=token;await h.DB.prepare('INSERT INTO game_users(id,google_sub,nickname,nickname_key,country,university,university_key,consent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,id+'-google',id,id,'KR','Test','test',now,now,now).run();await h.DB.prepare('INSERT INTO game_sessions VALUES(?,?,?)').bind(await Auth.digest(token),id,now+3600).run();}
async function pool(h,n){await h.DB.prepare("UPDATE game_cases SET active=0 WHERE kind='unscored' AND CAST(substr(id,5) AS INTEGER)>=?").bind(21+n).run();}
async function complete(h,who,boxes){let r=(await call(h,'rounds',{},who)).body;for(const c of r.items)r=(await call(h,`rounds/${r.id}/cases/${c.id}/submit`,{boxes,revision:0},who)).body;return r;}
function unscored(r){return r.items.filter(c=>Number(c.id.slice(4))>=21).map(c=>c.id).sort();}
test('never-assigned cases come first; only completed failures recycle after fresh pool runs out',async()=>{
 const h=await harness();await pool(h,14);await reader(h,'charlie');const a=await complete(h,'alice',[]),b=(await call(h,'rounds',{},'bob')).body;
 assert.ok(unscored(b).every(id=>!unscored(a).includes(id)));
 const c=(await call(h,'rounds',{},'charlie')).body;assert.deepEqual(unscored(c),unscored(a));assert.ok(unscored(c).every(id=>!unscored(b).includes(id)));
 assert.equal((await h.DB.prepare('SELECT COUNT(*) n FROM game_claims').first()).n,14);assert.equal((await h.DB.prepare('SELECT COUNT(*) n FROM game_round_cases WHERE round_id=?').bind(a.id).first()).n,10);
});
test('last fresh images are used before filling a set with failed images',async()=>{
 const h=await harness();await pool(h,9);const a=await complete(h,'alice',[]),b=(await call(h,'rounds',{},'bob')).body;
 assert.equal(unscored(b).filter(id=>unscored(a).includes(id)).length,5);assert.equal(unscored(b).filter(id=>!unscored(a).includes(id)).length,2);
});
test('active assignments, even after all gold answered badly, cannot be recycled',async()=>{
 const h=await harness();await pool(h,7);const a=(await call(h,'rounds',{})).body;
 for(const c of a.items.filter(c=>Number(c.id.slice(4))<21))await call(h,`rounds/${a.id}/cases/${c.id}/submit`,{boxes:[],revision:0});
 assert.equal((await call(h,'rounds',{},'bob')).status,409);assert.equal((await h.DB.prepare('SELECT COUNT(*) n FROM game_round_quality').first()).n,0);
});
test('50-point passing answers stay excluded from reassignment and remain candidates',async()=>{
 const h=await harness();await pool(h,7);const a=await complete(h,'alice',[ref[0]]);assert.equal(a.result.score,50);
 assert.equal((await call(h,'rounds',{},'bob')).status,409);assert.equal((await h.DB.prepare('SELECT COUNT(*) n FROM game_training_candidates').first()).n,7);
});
test('a reader never receives their own failed images a second time',async()=>{
 const h=await harness();await pool(h,7);await complete(h,'alice',[]);assert.equal((await call(h,'rounds',{},'alice')).status,409);
});
test('a recycled set that passes is retired and only its passing answers are exported',async()=>{
 const h=await harness();await pool(h,7);await reader(h,'charlie');const a=await complete(h,'alice',[]),b=await complete(h,'bob',[ref[0]]);assert.deepEqual(unscored(a),unscored(b));
 const candidates=(await h.DB.prepare('SELECT * FROM game_training_candidates').all()).results;assert.equal(candidates.length,7);assert.ok(candidates.every(c=>c.user_id==='bob'));assert.equal((await call(h,'rounds',{},'charlie')).status,409);
});
test('claim race rolls back a whole losing set without overlapping active assignments',async()=>{
 const h=await harness();await pool(h,7);await reader(h,'charlie');await complete(h,'alice',[]);
 const batch=h.DB.batch.bind(h.DB);let racing=true;h.DB.batch=async statements=>{if(racing){racing=false;assert.equal((await call(h,'rounds',{},'charlie')).status,200);}return batch(statements);};
 assert.equal((await call(h,'rounds',{},'bob')).status,409);
 assert.equal((await h.DB.prepare("SELECT COUNT(*) n FROM game_rounds WHERE user_id='bob'").first()).n,0);
 assert.ok((await h.DB.prepare('SELECT user_id FROM game_claims').all()).results.every(x=>x.user_id==='charlie'));
});
test('fresh images arriving during allocation prevent early recycling inside the atomic batch',async()=>{
 const h=await harness();await pool(h,7);const a=await complete(h,'alice',[]);const batch=h.DB.batch.bind(h.DB);let racing=true;
 h.DB.batch=async statements=>{if(racing){racing=false;await h.DB.prepare("UPDATE game_cases SET active=1 WHERE id IN ('case28','case29','case30','case31','case32','case33','case34')").run();}return batch(statements);};
 const b=await call(h,'rounds',{},'bob');assert.equal(b.status,200);assert.ok(unscored(b.body).every(id=>!unscored(a).includes(id)));
 assert.equal((await h.DB.prepare("SELECT COUNT(*) n FROM game_rounds WHERE user_id='bob'").first()).n,1);
});