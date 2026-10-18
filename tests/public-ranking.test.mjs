import test from 'node:test';
import assert from 'node:assert/strict';
import {publicNickname} from '../server/public-ranking.mjs';
import {harness,ref,beginReading} from './game-harness.mjs';
import {handle} from '../server/api.mjs';
test('public names expose only their ends, preserving multilingual graphemes and hiding short names',()=>{
 for(const [name,masked] of [['SnooHabits4921','Sn***21'],['밤샘코딩러','밤샘***딩러'],['抹茶ラテ中毒','抹茶***中毒'],['冰美式不加糖','冰美***加糖'],['Cafe\u0301Reader','Ca***er'],['👩‍⚕️a👨‍⚕️bc','👩‍⚕️a***bc'],['碳烤地瓜','碳***瓜'],['abc','a***c'],['ab','a***'],['a','***'],['','***']])assert.equal(publicNickname(name),masked);
});
test('public responses hide real and demo names, while own profile and administrator entries keep full names',async()=>{
 const h=await harness();h.DB.db.prepare("UPDATE game_users SET nickname='PrivateReader' WHERE id='bob'").run();
 const round=await (await handle(h.req('rounds',{},'bob'),h.env)).json();
 for(const c of round.items){await beginReading(h,`rounds/${round.id}/cases/${c.id}/submit`,'bob');await handle(h.req(`rounds/${round.id}/cases/${c.id}/submit`,{boxes:ref,revision:0},'bob'),h.env);}
 const response=await handle(h.req('leaderboard',undefined,'anonymous'),h.env),raw=await response.text(),data=JSON.parse(raw);
 assert.equal(data.entries[0].name,'Pr***er');assert.equal(data.entries[0].average,100);
 assert.ok(!raw.includes('PrivateReader'));assert.ok(!raw.includes('MolarMoon'));
 assert.equal((await (await handle(h.req('me',undefined,'bob'),h.env)).json()).user.nickname,'PrivateReader');
 h.DB.db.prepare('INSERT INTO game_admins VALUES(?,?)').run('alice',1);
 assert.ok((await (await handle(h.req('admin/demos'),h.env)).json()).entries.some(r=>r.nickname==='MolarMoon'));
 const countries=await (await handle(h.req('leaderboard?group=country',undefined,'anonymous'),h.env)).json();assert.equal(countries.entries[0].name,'KR');
 const institutions=await (await handle(h.req('leaderboard?group=university',undefined,'anonymous'),h.env)).json();assert.equal(institutions.entries[0].name,'Test University');
});
test('distinct full names with the same masked nickname remain distinct without changing real records',async()=>{
 const h=await harness();
 const insert=h.DB.db.prepare('INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) VALUES(?,?,?,?,?,?)');
 for(let i=0;i<200;i++)insert.run('demo-'+(1000+i),'Same'+i+'DisplayName','US','Individual',70,3);
 const data=await (await handle(h.req('leaderboard',undefined,'anonymous'),h.env)).json();
 assert.equal(data.demo_entries.length,224);assert.equal(data.demo_entries.filter(r=>r.name==='Sa***me').length,200);assert.deepEqual(data.entries,[]);
});
