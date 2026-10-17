import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {harness,ref} from './game-harness.mjs';
import {handle} from '../server/api.mjs';
import Ranking from '../dist/play/ranking.js';
const get=async(h,path,who='alice')=>await (await handle(h.req(path,undefined,who),h.env)).json();
async function complete(h,who,boxes=ref){
 const round=await (await handle(h.req('rounds',{},who),h.env)).json();
 for(const c of round.items)assert.equal((await handle(h.req(`rounds/${round.id}/cases/${c.id}/submit`,{boxes,revision:0},who),h.env)).status,200);
}

test('private standing uses authenticated identity and has no rank until a set completes',async()=>{
 const h=await harness();
 assert.equal((await handle(h.req('me/ranking',undefined,'anonymous'),h.env)).status,401);
 let own=await get(h,'me/ranking');assert.equal(own.state,'unranked');assert.equal(own.rank,null);assert.equal(own.points,0);
 await complete(h,'bob');
 own=await get(h,'me/ranking?user_id=bob');assert.equal(own.nickname,'Alice');assert.equal(own.rank,null);
 const response=await handle(h.req('me/ranking',undefined,'bob'),h.env);
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie');
 own=await response.json();assert.equal(own.state,'ranked');assert.equal(own.points,10);assert.equal(own.questions,10);assert.equal(own.average,100);
 const board=await get(h,'leaderboard','anonymous');assert.equal(board.entries[0].rank,own.rank);
 const raw=JSON.stringify(board);for(const privateValue of ['user_id','row_id','nickname','Alice','Bob'])assert.ok(!raw.includes(privateValue));
});

test('personal rank includes all competitors, beyond the public top 250, and updates after another completed set',async()=>{
 const h=await harness();h.DB.db.exec('DELETE FROM game_demo_leaders');
 const insert=h.DB.db.prepare('INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES(?,?,?,?,?,?)');
 for(let i=0;i<270;i++)insert.run('demo-'+(1000+i),'Reader'+i,'US','Individual',100,2);
 await complete(h,'bob');
 let own=await get(h,'me/ranking','bob');assert.equal(own.rank,271);assert.equal(own.points,10);
 let board=await get(h,'leaderboard','anonymous');assert.equal(board.entries.length,0);assert.equal(board.demo_entries.length,250);
 await complete(h,'bob');own=await get(h,'me/ranking','bob');assert.equal(own.rank,1);assert.equal(own.points,20);assert.equal(own.questions,20);
 board=await get(h,'leaderboard','anonymous');assert.equal(board.entries[0].rank,1);
});

test('mask collisions and tied scores do not change server order or identify another reader as me',async()=>{
 const h=await harness();h.DB.db.exec("DELETE FROM game_demo_leaders; UPDATE game_users SET nickname='AbZcd' WHERE id='alice'; UPDATE game_users SET nickname='AbAcd' WHERE id='bob'");
 await complete(h,'alice');await complete(h,'bob');
 const data=await get(h,'leaderboard','anonymous'),view=Ranking.entries(data,'individual');
 assert.deepEqual(view.map(r=>r.name),['Ab***cd','Ab***cd']);assert.deepEqual(view.map(r=>r.rank),[1,2]);
 assert.equal((await get(h,'me/ranking','bob')).rank,1);assert.equal((await get(h,'me/ranking','alice')).rank,2);
 assert.deepEqual(Ranking.entries({entries:[...data.entries].reverse()},'individual').map(r=>r.rank),[1,2]);
});

test('zero score is ranked after completion, while administrator points stay private without an invented rank',async()=>{
 const h=await harness();await complete(h,'bob',[]);
 const bob=await get(h,'me/ranking','bob');assert.equal(bob.state,'ranked');assert.equal(bob.points,0);assert.equal(bob.average,0);assert.ok(bob.rank>0);
 h.DB.db.prepare('INSERT INTO game_admins VALUES(?,?)').run('alice',1);await complete(h,'alice');
 const own=await get(h,'me/ranking');assert.equal(own.state,'excluded');assert.equal(own.rank,null);assert.equal(own.points,10);assert.equal(own.questions,10);
 for(const group of ['individual','country'])assert.equal((await get(h,'leaderboard?group='+group,'anonymous')).entries.length,1);
});

test('institution tab is hidden in both entry points, with private score card and institution profile preserved',()=>{
 for(const file of ['dist/index.html','dist/play/index.html']){
  const html=fs.readFileSync(file,'utf8');assert.ok(!html.includes('data-group="university"'));assert.ok(html.includes('data-group="individual"'));assert.ok(html.includes('data-group="country"'));
  assert.match(html,/<aside id="my-ranking"[^>]* hidden>/);assert.ok(html.includes('id="university"'));
 }
});

test('new and renamed demo records reject normalized duplicate full names but allow an unchanged name',async()=>{
 const h=await harness();h.DB.db.prepare('INSERT INTO game_admins VALUES(?,?)').run('alice',1);
 const input={request_id:crypto.randomUUID(),nickname:'ＮｏｕｖｅｌｌｅＬｕｎｅ',country:'FR',university:'Individual',average:80,rounds:3};
 assert.equal((await handle(h.req('admin/demos',input),h.env)).status,200);
 assert.equal((await handle(h.req('admin/demos',{...input,request_id:crypto.randomUUID(),nickname:'  nouvellelune  '}),h.env)).status,409);
 assert.equal((await handle(h.req('admin/demos/demo-01/rename',{nickname:'nouvellelune',revision:0}),h.env)).status,409);
 assert.equal((await handle(h.req('admin/demos/demo-'+input.request_id+'/rename',{nickname:'NouvelleLune',revision:0}),h.env)).status,200);
 assert.equal(h.DB.db.prepare('SELECT COUNT(*) n FROM game_demo_leaders').get().n,25);
});
