const {test}=require('node:test'),assert=require('node:assert/strict'),P=require('../dist/core'),Z=require('../dist/zip');
const im=()=>({id:'x',name:'x',width:100,height:60,file:'images/x.png',base:'hash',boxes:[{id:'c:1',category:'caries_ungraded',geometry:'lesion_box',bbox:[10,10,20,20],status:'draft'}],review:{caries:false,findings:false,hanoi:false},needs_review:false});
test('pending predictions cannot mark complete',()=>assert.throws(()=>P.complete(im(),'all')));
test('confirmed boxes complete independently',()=>{const x=im();P.edit(x,'c:1',{status:'confirmed'});P.complete(x,'caries');assert.equal(x.review.caries,true);assert.equal(x.review.hanoi,false);P.edit(x,'c:1',{bbox:[12,12,25,25],status:'editing'});assert.equal(x.review.caries,false)});
test('locked masks reject geometry edits',()=>{const x=im();x.boxes[0].locked=true;assert.throws(()=>P.edit(x,'c:1',{bbox:[12,12,25,25]}))});
test('bad coordinates rejected',()=>{for(const a of [[-1,2,3,4],[1,2,101,30],[NaN,1,2,3],[2,2,1,4]])assert.throws(()=>P.edit(im(),'c:1',{bbox:a}))});
test('empty image negative needs explicit completion',()=>{const x=im();x.boxes=[];P.complete(x,'hanoi');assert.equal(x.review.hanoi,true);assert.equal(x.review.caries,false)});
test('class semantics not silently changed',()=>assert.throws(()=>P.edit(im(),'c:1',{category:'impacted_tooth'})));
test('CRC32 known vector',()=>assert.equal(Z.crc32(Buffer.from('123456789')),0xcbf43926));
test('malformed ZIP rejected',async()=>await assert.rejects(()=>Z.open(new Blob(['bad']))));
test('actual Python-generated package can be read lazily',async()=>{
 if(!process.env.PANO_TEST_ZIP)return;
 const fs=require('node:fs'),z=await Z.open(new Blob([fs.readFileSync(process.env.PANO_TEST_ZIP)])),m=P.validate(await z.json('labels.json'));
 assert(m.images.length);assert((await z.bytes(m.images[0].file)).length>0);
});
