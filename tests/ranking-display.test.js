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
 assert.equal(view[0].average,82.5);assert.equal(view[0].rounds,4);assert.equal(view[0].members,3);assert.equal(view[0].questions,40);assert.equal(view[0].points,33);
 const teams=entries({entries:[row('Test University','US',60,1)],demo_entries:[row('test  university','US',90,3),row('Test University','KR',70,2)]},'university');
 assert.equal(teams.length,2);assert.equal(teams[0].average,82.5);assert.equal(teams[0].country,'US');
});
test('without demo records the public display retains real scores and empty state',()=>{
 const data={entries:[row('Real','KR',72.5,4)]};assert.deepEqual(entries(data,'individual').map(({university,questions,points,...r})=>r),data.entries);
 assert.equal(entries(data,'individual')[0].questions,40);assert.equal(entries(data,'individual')[0].points,29);
 assert.deepEqual(entries({entries:[],demo_entries:[]},'country'),[]);
});
test('all categories rank accumulated points ahead of average accuracy',()=>{
 for(const group of ['individual','country','university']){
  const data={entries:[row('Vietnam','VN',87.8,17,2),row('Sweden','SE',87,18,2),row('Australia','AU',86.1,83,10)]};
  const view=entries(data,group);assert.deepEqual(view.map(r=>r.country),['AU','SE','VN']);
  for(const [i,p] of [714.63,156.6,149.26].entries())assert.ok(Math.abs(view[i].points-p)<1e-10);
  assert.deepEqual(view.map(r=>r.questions),[830,180,170]);
 }
});
test('team averages weight actual questions and points add without rounding',()=>{
 const view=entries({entries:[{...row('A','KR',100,1),questions:5,points:5}],demo_entries:[{...row('a','KR',50,1),questions:10,points:5}]},'university');
 assert.equal(view.length,1);assert.equal(view[0].points,10);assert.equal(view[0].questions,15);assert.equal(view[0].average,1000/15);
});
test('unaffiliated readers do not create institution teams and tied points prefer accuracy',()=>{
 const data={entries:[row(' Individual ','KR',100,100),row('High','KR',100,1),row('Low','KR',50,2)]};
 assert.deepEqual(entries(data,'university').map(r=>r.name),['High','Low']);
 assert.equal(entries(data,'individual').length,3);assert.equal(entries(data,'country')[0].questions,1030);
});
