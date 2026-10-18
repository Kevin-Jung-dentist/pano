import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,ref,beginReading} from './game-harness.mjs';
import {handle} from '../server/api.mjs';
const count=(h,table)=>h.DB.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
const tables=['game_users','game_sessions','game_rounds','game_round_cases','game_claims','game_round_quality','game_payments'];
const state=h=>Object.fromEntries(tables.map(t=>[t,count(h,t)]));
function grant(h){h.DB.db.prepare('INSERT INTO game_admins VALUES(?,?)').run('alice',1);}
test('demo readers are isolated from actual users, scores and training records in all views',async()=>{
 const h=await harness(),before=state(h);
 assert.equal(count(h,'game_demo_leaders'),24);
 for(const group of ['individual','country','university']){
  const res=await handle(h.req('leaderboard?group='+group,undefined,'anonymous'),h.env);assert.equal(res.status,200);
  const data=await res.json();assert.deepEqual(data.entries,[]);assert.equal(data.demo_entries.length,group==='individual'?24:12);
  assert.ok(data.demo_entries.every(x=>x.is_demo===true));
  if(group==='individual')assert.equal(new Set(data.demo_entries.map(x=>x.country)).size,12);
 }
 assert.deepEqual(state(h),before);
 const me=await (await handle(h.req('me'),h.env)).json();assert.equal(me.user.is_admin,false);assert.equal(me.stats.rounds,0);
});
test('admin requires an explicit server role, never a client flag or admin nickname',async()=>{
 const h=await harness();h.DB.db.prepare("UPDATE game_users SET nickname='admin',nickname_key='admin' WHERE id='bob'").run();
 for(const [who,expected] of [['anonymous',401],['bob',403],['alice',403]]){
  for(const [url,b] of [['admin/demos',undefined],['admin/demos',{nickname:'FakeAdmin',is_admin:true}],['admin/demos/demo-01/rename',{nickname:'FakeAdmin',revision:0,is_admin:true}],['admin/demos/demo-01/delete',{revision:0}],['admin/demos/delete-all',{confirm:'DELETE_DEMOS'}]])assert.equal((await handle(h.req(url,b,who),h.env)).status,expected);
 }
 grant(h);assert.equal((await (await handle(h.req('me'),h.env)).json()).user.is_admin,true);
 assert.equal((await handle(h.req('admin/demos'),h.env)).status,200);
 assert.equal((await handle(h.req('admin/demos/delete-all',{confirm:'DELETE_DEMOS'},'alice','https://evil.example'),h.env)).status,403);
 assert.equal(count(h,'game_demo_leaders'),24);
});
test('rename persists and stale or invalid edits preserve the saved nickname',async()=>{
 const h=await harness();grant(h);const before=state(h);
 assert.equal((await handle(h.req('admin/demos/demo-01/rename',{nickname:'  새이름É  ',revision:0}),h.env)).status,200);
 const read=async()=>(await (await handle(h.req('admin/demos'),h.env)).json()).entries.find(x=>x.id==='demo-01');
 assert.equal((await read()).nickname,'새이름É');assert.equal((await read()).revision,1);
 assert.equal((await handle(h.req('admin/demos/demo-01/rename',{nickname:'Stale',revision:0}),h.env)).status,409);
 for(const nickname of ['x','x'.repeat(25),'<script>','bad\u202Ename'])assert.equal((await handle(h.req('admin/demos/demo-01/rename',{nickname,revision:1}),h.env)).status,400);
 assert.equal((await handle(h.req('admin/demos/demo-01/delete',{revision:0}),h.env)).status,409);
 assert.equal((await read()).nickname,'새이름É');assert.deepEqual(state(h),before);
 const ranks=await (await handle(h.req('leaderboard'),h.env)).json();assert.ok(ranks.demo_entries.some(x=>x.name==='새***É'&&x.is_demo));
});
test('individual and bulk deletion remove only demo rows, remain deleted, and cannot target real user ids',async()=>{
 const h=await harness();grant(h);
 const round=await (await handle(h.req('rounds',{},'bob'),h.env)).json();
 for(const c of round.items){await beginReading(h,`rounds/${round.id}/cases/${c.id}/submit`,'bob');assert.equal((await handle(h.req(`rounds/${round.id}/cases/${c.id}/submit`,{boxes:ref,revision:0},'bob'),h.env)).status,200);}
 const before=state(h),realBefore=(await (await handle(h.req('leaderboard'),h.env)).json()).entries;
 assert.equal(realBefore.length,1);assert.equal(realBefore[0].average,100);
 assert.equal((await handle(h.req('admin/demos/alice/delete',{revision:0}),h.env)).status,404);
 assert.equal((await handle(h.req('admin/demos/demo-01/delete',{revision:0}),h.env)).status,200);assert.equal(count(h,'game_demo_leaders'),23);
 assert.equal((await handle(h.req('admin/demos/delete-all',{}),h.env)).status,400);
 const response=await (await handle(h.req('admin/demos/delete-all',{confirm:'DELETE_DEMOS'}),h.env)).json();assert.equal(response.deleted,23);
 for(const group of ['individual','country','university'])assert.deepEqual((await (await handle(h.req('leaderboard?group='+group),h.env)).json()).demo_entries,[]);
 assert.equal((await (await handle(h.req('admin/demos/delete-all',{confirm:'DELETE_DEMOS'}),h.env)).json()).deleted,0);
 assert.deepEqual(state(h),before);
 const realAfter=(await (await handle(h.req('leaderboard'),h.env)).json()).entries;
 assert.equal(realAfter[0].rank,1);assert.equal(realBefore[0].rank,25);
 assert.deepEqual(realAfter.map(({rank,...r})=>r),realBefore.map(({rank,...r})=>r));
});
const creation=()=>({request_id:crypto.randomUUID(),nickname:'NouvelleLune',country:'FR',university:'Paris Study Circle',average:87.5,rounds:4});
test('administrator can create, retry without duplication, rename and delete a new demo record',async()=>{
 const h=await harness();grant(h);const before=state(h),input=creation();
 for(let i=0;i<2;i++){const res=await handle(h.req('admin/demos',input),h.env);assert.equal(res.status,200);const {entry}=await res.json();assert.equal(entry.nickname,input.nickname);assert.equal(entry.id,'demo-'+input.request_id);}
 assert.equal(count(h,'game_demo_leaders'),25);assert.deepEqual(state(h),before);
 assert.equal((await handle(h.req('admin/demos',{...input,average:44}),h.env)).status,409);
 const list=await (await handle(h.req('admin/demos'),h.env)).json();assert.equal(list.entries.find(x=>x.id==='demo-'+input.request_id).average,87.5);
 assert.equal((await handle(h.req(`admin/demos/demo-${input.request_id}/rename`,{nickname:'NewName',revision:0}),h.env)).status,200);
 assert.ok((await (await handle(h.req('leaderboard'),h.env)).json()).demo_entries.some(x=>x.name==='Ne***me'));
 assert.equal((await handle(h.req(`admin/demos/demo-${input.request_id}/delete`,{revision:1}),h.env)).status,200);assert.equal(count(h,'game_demo_leaders'),24);
});
test('creation rejects invalid fields and foreign origins without any insertion',async()=>{
 const h=await harness();grant(h);
 for(const patch of [{nickname:'<script>'},{nickname:'x'},{country:'XX'},{university:''},{average:-1},{average:100.1},{average:'88'},{rounds:0},{rounds:1.5},{rounds:100001},{request_id:'bad'}])assert.equal((await handle(h.req('admin/demos',{...creation(),...patch}),h.env)).status,400);
 assert.equal((await handle(h.req('admin/demos',creation(),'alice','https://evil.example'),h.env)).status,403);
 assert.equal(count(h,'game_demo_leaders'),24);
});
test('administrator records are excluded from every public ranking while personal history and scores remain',async()=>{
 const h=await harness();grant(h);
 const round=await (await handle(h.req('rounds',{}),h.env)).json();
 for(const c of round.items){await beginReading(h,`rounds/${round.id}/cases/${c.id}/submit`,'alice');await handle(h.req(`rounds/${round.id}/cases/${c.id}/submit`,{boxes:ref,revision:0}),h.env);}
 for(const mode of ['individual','country','university'])assert.deepEqual((await (await handle(h.req('leaderboard?group='+mode),h.env)).json()).entries,[]);
 const own=await (await handle(h.req('me'),h.env)).json();assert.equal(own.stats.rounds,1);assert.equal(own.stats.average,100);
 assert.equal((await (await handle(h.req('rounds'),h.env)).json()).rounds.length,1);
});
