import test from 'node:test';
import assert from 'node:assert/strict';
import G from '../dist/game-core.js';
import {harness} from './game-harness.mjs';
import {handle} from '../server/api.mjs';
import {now} from '../server/auth.mjs';
const im={width:1200,height:650,scope:G.labelCategories};
const b=(id,bbox,category='caries_ungraded',finding_id=id)=>({id,finding_id,bbox,category,geometry:G.geometry[category]});
const deep=b('tooth',[100,100,200,300],'deep_caries'),inside=b('answer',[120.25,130.5,140.75,150.25]);
const call=async(h,path,body,who='alice')=>{const r=await handle(h.req(path,body,who),h.env);return {status:r.status,body:await r.json()};};

test('a caries box fully inside a verified deep-caries tooth receives full credit without claiming perfect lesion IoU',()=>{
 const g=G.grade([inside],[deep],im);assert.equal(g.score,100);assert.equal(g.tp,1);assert.equal(g.credit_sum,1);assert.equal(g.containment_tp,1);assert.equal(g.mean_iou,null);assert.equal(g.iou_sum,0);
 assert.equal(g.matches[0].method,'deep_caries_containment');assert.equal(g.matches[0].iou,null);assert.equal(g.matches[0].reference_id,deep.id);
 assert.equal(G.grade([b('equal',deep.bbox)],[deep],im).score,100);
 assert.equal(G.grade([b('corner',[100,100,101,101])],[deep],im).score,100);
});

test('partial overlap, a box surrounding the tooth, an outside box and a wrong class are not accepted as containment',()=>{
 for(const pred of [b('overlap',[99.9,130,150,170]),b('surround',[50,50,250,350]),b('outside',[250,100,260,120]),b('wrong',inside.bbox,'periapical_lesion')]){
  const g=G.grade([pred],[deep],im);assert.equal(g.tp,0);assert.equal(g.fp,1);assert.equal(g.fn,1);assert.equal(g.score,0);
 }
});

test('ordinary lesion references retain their IoU threshold and partial-overlap credit',()=>{
 const fine=b('fine',[100,100,200,200]);assert.equal(G.grade([b('small',[100,100,110,110])],[fine],im).tp,0);
 assert.equal(G.grade([b('half',[100,100,150,200])],[fine],im).score,50);
 const peri={...fine,category:'periapical_lesion'};assert.equal(G.grade([b('p',[100,100,150,200],'periapical_lesion')],[peri],im).score,50);
});

test('contained fine labels and their coarse deep-caries tooth count once, with duplicate answers penalized',()=>{
 const fine=b('fine',inside.bbox),refs=[deep,fine],before=JSON.stringify(refs);
 const g=G.grade([inside],refs,im);assert.equal(g.reference_count,1);assert.equal(g.score,100);assert.equal(JSON.stringify(refs),before);
 const duplicate=G.grade([inside,b('duplicate',[160,160,180,190])],refs,im);assert.equal(duplicate.reference_count,1);assert.equal(duplicate.tp,1);assert.equal(duplicate.fp,1);assert.equal(duplicate.score,75);
 assert.equal(G.grade([inside],[...refs].reverse(),im).score,100);
});

test('one-to-one matching is independent of answer order, and unrelated findings remain separate',()=>{
 const other=b('other',[400,100,500,300],'deep_caries'),fine=b('fine',[700,100,800,200]),p2=b('p2',[420,120,450,150]),p3=b('p3',fine.bbox);
 const refs=[deep,other,fine],pred=[inside,p2,p3];
 for(const r of [refs,[...refs].reverse()])for(const p of [pred,[...pred].reverse()]){const g=G.grade(p,r,im);assert.equal(g.reference_count,3);assert.equal(g.score,100);assert.equal(g.containment_tp,2);assert.equal(g.mean_iou,1);}
});

test('deep-caries scoring, ranking, quality threshold and timed-out candidate collection agree end to end',async()=>{
 const h=await harness();const normal=b('normal',[700,100,800,200]);
 h.DB.db.prepare("UPDATE game_cases SET reference_json=? WHERE kind='verified'").run(JSON.stringify([deep,normal]));
 h.DB.db.prepare('INSERT INTO game_case_ai_context SELECT id,?,? FROM game_cases').run(JSON.stringify({boxes:[b('ai-only',[900,100,950,150],'deep_caries')]}),now());
 let r=(await call(h,'rounds',{})).body;
 for(const c of r.items){
  r=(await call(h,`rounds/${r.id}/cases/${c.id}/begin`,{})).body;
  assert.ok(!JSON.stringify(r).includes('ai-only'));assert.ok(!JSON.stringify(r).includes('reference_id'));
  await call(h,`rounds/${r.id}/cases/${c.id}/draft`,{boxes:[inside],revision:0});
  h.DB.db.prepare('UPDATE game_round_cases SET deadline_at=? WHERE round_id=? AND case_id=?').run(now()-1,r.id,c.id);
  r=(await call(h,'rounds/'+r.id)).body;
 }
 assert.equal(r.result.score,50);assert.equal(r.state,'complete');assert.ok(r.result.details.some(x=>x.reference?.some(b=>b.category==='deep_caries'&&b.geometry==='tooth_box')));
 assert.equal((await call(h,'me/ranking')).body.average,50);assert.equal(h.DB.db.prepare('SELECT score FROM game_round_quality').get().score,50);
 const candidates=h.DB.db.prepare('SELECT * FROM game_training_candidates').all();assert.equal(candidates.length,7);assert.ok(candidates.every(c=>c.coverage==='partial'&&c.ai_context_json===null&&c.validation_score===50));
 assert.ok(candidates.every(c=>JSON.parse(c.boxes_json)[0].bbox[0]===120.25));
});

test('a bank with only verified deep caries can start a new set',async()=>{
 const h=await harness();h.DB.db.prepare("UPDATE game_cases SET reference_json=? WHERE kind='verified'").run(JSON.stringify([deep]));
 assert.equal((await call(h,'rounds',{})).status,200);
});

test('v3 rounds keep their timer, saved IoU grading and training qualification but no longer send AI drafts',async()=>{
 const h=await harness();let r=(await call(h,'rounds',{})).body;
 h.DB.db.prepare('UPDATE game_rounds SET rule_version=? WHERE id=?').run(G.weightedVersion,r.id);
 const ai={boxes:[b('old-hint',deep.bbox,'deep_caries')]};h.DB.db.prepare('UPDATE game_round_cases SET ai_context_json=? WHERE round_id=?').run(JSON.stringify(ai),r.id);
 const {ref}=await import('./game-harness.mjs');
 for(const c of r.items){r=(await call(h,`rounds/${r.id}/cases/${c.id}/begin`,{})).body;assert.equal(r.case_seconds,120);assert.ok(!JSON.stringify(r).includes('old-hint'));r=(await call(h,`rounds/${r.id}/cases/${c.id}/submit`,{boxes:[...ref,b('extra',[0,0,10,10])],revision:0})).body;}
 assert.equal(r.result.score,87.5);assert.equal(r.result.legacy,false);assert.equal(h.DB.db.prepare('SELECT score FROM game_round_quality').get().score,87.5);assert.equal((await call(h,'me/ranking')).body.average,87.5);
 assert.equal(h.DB.db.prepare('SELECT COUNT(*) n FROM game_training_candidates').get().n,7);
 assert.equal(G.gradeFor(G.weightedVersion,[inside],[deep],{...im,scope:G.categories}).score,0);
});
