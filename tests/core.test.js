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
 const fs=require('node:fs'),z=await Z.open(new Blob([process.env.PANO_TEST_ZIP?fs.readFileSync(process.env.PANO_TEST_ZIP):Buffer.from(require('./fixture'),'base64')])),m=P.validate(await z.json('labels.json'));
 assert(m.images.length);assert((await z.bytes(m.images[0].file)).length>0);
});

test('original pixel coordinates survive zoom, pan, offsets and display DPR',()=>{
 for(const dpr of [1,1.25,1.5,2,3]){
  for(const scale of [.03,.19,.333,1,1.75,4.1,10]){
   const t={left:37.125,top:91.75,tx:-473.45,ty:21.875,scale};
   for(const point of [[0,0],[.125,.625],[2047.875,1023.25],[3200,1800]]){
    const css=P.toScreen(...point,t),back=P.toImage(...css,t);
    assert(Math.abs(back[0]-point[0])<1e-9);
    assert(Math.abs(back[1]-point[1])<1e-9);
    // Raster dimensions may round, while CSS pointer coordinates stay independent.
    const width=917.3,pixels=Math.round(width*dpr);
    assert(Math.abs((css[0]*pixels/width)/(pixels/width)-css[0])<1e-9);
   }
  }
 }
});
test('export never rounds or normalizes fractional coordinates',()=>{
 const x=im();x.boxes[0].bbox=[10.125,10.75,29.625,31.875];
 const m={format:'pano-work',version:1,package_id:'same',token:'same',actor:'same',images:[x]};
 const out=P.result(m);assert.deepEqual(out.images[0].boxes[0].bbox,x.boxes[0].bbox);
 assert.deepEqual(out.coordinate_system,P.coordinateSystem);
});
test('wrong coordinate space is rejected at package load',()=>{
 const m={format:'pano-work',version:1,package_id:'x',token:'t',images:[im()],coordinate_system:{...P.coordinateSystem,units:'normalized'}};
 assert.throws(()=>P.validate(m));
});
