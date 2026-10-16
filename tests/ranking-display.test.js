const test=require('node:test'),assert=require('node:assert/strict');
const {entries}=require('../dist/play/ranking.js');
const row=(name,country,average,rounds,members=1)=>({name,country,average,rounds,members});
test('public display combines records by score without demo markers and preserves inputs',()=>{
 const data={entries:[row('Real','US',80,2)],demo_entries:[{...row('Sample','KR',90,3),is_demo:true}]};
 const original=JSON.stringify(data),view=entries(data,'individual');
 assert.deepEqual(view.map(x=>x.name),['Sample','Real']);assert.ok(view.every(x=>!('is_demo' in x)));
 assert.equal(JSON.stringify(data),original);
});
test('country and institution rows merge by weighted completed sets, never averaging the averages',()=>{
 const data={entries:[row('US','US',60,1)],demo_entries:[row('US','US',90,3,2),row('KR','KR',85,2)]};
 const view=entries(data,'country');assert.equal(view.length,2);
 assert.equal(view[1].average,82.5);assert.equal(view[1].rounds,4);assert.equal(view[1].members,3);
 const teams=entries({entries:[row('Test University','US',60,1)],demo_entries:[row('test  university','US',90,3),row('Test University','KR',70,2)]},'university');
 assert.equal(teams.length,2);assert.equal(teams[0].average,82.5);assert.equal(teams[0].country,'US');
});
test('without demo records the public display retains real scores and empty state',()=>{
 const data={entries:[row('Real','KR',72.5,4)]};assert.deepEqual(entries(data,'individual').map(({university,...r})=>r),data.entries);
 assert.deepEqual(entries({entries:[],demo_entries:[]},'country'),[]);
});
