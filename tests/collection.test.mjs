import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {collectCandidates} from '../scripts/collect-candidates.mjs';
import G from '../dist/game-core.js';
function fixture(){
 const dir=fs.mkdtempSync('F:/pano/tmp/collection-test-');const image=path.join(dir,'image.png');fs.writeFileSync(image,'test-fixture');
 const c={id:'image1',group_id:'group1',object_key:'lod/hanoi/image1.png',width:1200,height:650,kind:'unscored',split:'train',scope:G.categories,source:'hanoi',local_image:image,license:'CC BY 4.0',attribution:'Hanoi'};
 const candidate={round_id:'round1',case_id:c.id,group_id:c.group_id,object_key:c.object_key,width:c.width,height:c.height,source:c.source,user_id:'reader1',validation_score:50,quality_threshold:50,review_state:'candidate_needs_review',training_ready:false,coordinate_system:G.coordinateSystem,boxes:[{id:'x',category:'caries_ungraded',geometry:'lesion_box',bbox:[10.125,11.75,30.5,40.25]}]};
 return {dir,out:path.join(dir,'collected'),manifest:{schema:'lod-question-bank-v1',cases:[c]},bundle:{schema:'lod-training-candidates-v1',created_at:'2026-10-17T00:00:00Z',candidates:[candidate]}};
}
test('collecting twice does not duplicate labels, round pixels or overwrite owner review notes',()=>{
 const h=fixture(),a=collectCandidates(h.bundle,h.manifest,h.out);assert.equal(a.added,1);const notes=path.join(h.out,'reviews','my-review.json');fs.writeFileSync(notes,'owner review');
 const b=collectCandidates(h.bundle,h.manifest,h.out);assert.equal(b.added,0);assert.equal(b.updated,0);assert.equal(fs.readdirSync(path.join(h.out,'candidates')).length,1);assert.equal(fs.readFileSync(notes,'utf8'),'owner review');
 const file=JSON.parse(fs.readFileSync(b.index)).candidates[0].file,c=JSON.parse(fs.readFileSync(path.join(h.out,file)));assert.deepEqual(c.boxes,h.bundle.candidates[0].boxes);assert.equal(c.training_ready,false);assert.equal(c.local_image,path.resolve(h.manifest.cases[0].local_image));
});
test('collection rejects failed quality, evaluation leakage and wrong coordinates before writing',()=>{
 for(const change of [h=>h.bundle.candidates[0].validation_score=49,h=>h.manifest.cases[0].split='test',h=>h.bundle.candidates[0].coordinate_system={space:'normalized'},h=>h.bundle.candidates[0].width=1199]){
 const h=fixture();change(h);assert.throws(()=>collectCandidates(h.bundle,h.manifest,h.out));assert.equal(fs.existsSync(h.out),false);
 }
});
test('empty export is explicit and does not treat old archived files as current training candidates',()=>{
 const h=fixture();collectCandidates(h.bundle,h.manifest,h.out);h.bundle.candidates=[];const r=collectCandidates(h.bundle,h.manifest,h.out);assert.equal(r.collected,0);assert.equal(JSON.parse(fs.readFileSync(r.index)).auto_training,false);assert.equal(fs.readdirSync(path.join(h.out,'candidates')).length,1);assert.ok(fs.readFileSync(r.report,'utf8').includes('아직 기준을 통과한 완료 답안이 없습니다'));
});