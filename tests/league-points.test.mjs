import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {harness,ref,beginReading} from './game-harness.mjs';
import {handle} from '../server/api.mjs';
import {publicLeaderboard} from '../server/public-ranking.mjs';
import Ranking from '../dist/play/ranking.js';
const get=async(h,path,who='alice')=>(await (await handle(h.req(path,undefined,who),h.env)).json());
async function complete(h,who,boxes){
 const round=await (await handle(h.req('rounds',{},who),h.env)).json();
 for(const c of round.items){await beginReading(h,`rounds/${round.id}/cases/${c.id}/submit`,who);await handle(h.req(`rounds/${round.id}/cases/${c.id}/submit`,{boxes,revision:0},who),h.env);}
 return round;
}
test('completed sets contribute score-weighted questions in every category; active work contributes nothing',async()=>{
 const h=await harness();await handle(h.req('rounds',{}),h.env);
 await complete(h,'bob',ref);await complete(h,'bob',[ref[0]]);
 for(const mode of ['individual','country','university']){
  const data=await get(h,'leaderboard?group='+mode,'anonymous');assert.equal(data.entries.length,1);
  const r=data.entries[0];assert.equal(r.points,15);assert.equal(r.questions,20);assert.equal(r.average,75);assert.equal(r.rounds,2);
 }
 const own=await get(h,'me','bob');assert.equal(own.stats.average,75);assert.equal(own.stats.rounds,2);
});
test('demo candidate selection uses points before limiting and the ranking has no Readers or Sets column',async()=>{
 const h=await harness();h.DB.db.exec('DELETE FROM game_demo_leaders');
 const add=h.DB.db.prepare('INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES(?,?,?,?,?,?)');
 for(let i=0;i<260;i++)add.run('demo-'+(1000+i),'Perfect'+i,'US','Individual',100,1);
 add.run('demo-9999','SteadyReader','US','Individual',50,100);
 const data=await get(h,'leaderboard','anonymous');assert.equal(data.demo_entries.length,250);
 assert.equal(data.demo_entries[0].name,'St***er');assert.equal(data.demo_entries[0].points,500);assert.equal(data.demo_entries[0].questions,1000);
 assert.equal((await get(h,'leaderboard?group=university','anonymous')).demo_entries.length,0);
 const country=(await get(h,'leaderboard?group=country','anonymous')).demo_entries[0];assert.equal(country.points,3100);assert.equal(country.questions,3600);
 const html=fs.readFileSync('dist/index.html','utf8').match(/<section id="ranking-panel">([\s\S]*?)<\/section>/)[1];
 assert.ok(!html.includes('data-i18n="members"'));assert.ok(!html.includes('data-i18n="sets"'));assert.ok(html.includes('data-i18n="rankPoints"'));assert.ok(html.includes('data-i18n="rankQuestions"'));
});
test('teams merge source totals before the top-250 cut, and individual limits apply across both sources',()=>{
 const item=(name,points)=>({name,country:'US',university:name,points,questions:1000,average:points/10,rounds:100,members:1});
 const real=Array.from({length:250},(_,i)=>item('A'+i,100)),demos=Array.from({length:250},(_,i)=>({...item('B'+i,100),is_demo:true}));
 real.push(item('Joint Institution',90));demos.push({...item('joint  institution',90),is_demo:true});
 const data=publicLeaderboard(real,demos,'university'),view=Ranking.entries(data,'university');
 assert.equal(view.length,250);assert.equal(view[0].points,180);assert.equal(view[0].questions,2000);assert.equal(view[0].name,'Joint Institution');
 const individual=publicLeaderboard(real,demos,'individual');assert.equal(individual.entries.length+individual.demo_entries.length,250);
});
