const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const G=require('../dist/game-core.js');
function setup(scale=1){
 const events={},keys={},changes=[],buttons=new Map();
 const ctx2d=new Proxy({},{get:()=>()=>{}});
 const canvas={style:{},getContext:()=>ctx2d,addEventListener:(k,fn)=>events[k]=fn,getBoundingClientRect:()=>({left:20,top:30,width:900,height:600}),focus(){},setPointerCapture(id){this.capture=id;},hasPointerCapture(id){return this.capture===id;},releasePointerCapture(){this.capture=null;},closest:()=>null};
 const window={PanoGame:G,devicePixelRatio:2,addEventListener:(k,fn)=>keys[k]=fn,LoDI18n:{t:k=>k}};
 const document={getElementById:id=>{if(!buttons.has(id))buttons.set(id,{classList:{toggle(){}},setAttribute(){}});return buttons.get(id);}};
 const context=vm.createContext({window,document,crypto,structuredClone,ResizeObserver:class{observe(){}},Image:class{}});vm.runInContext(fs.readFileSync('dist/play/canvas.js','utf8'),context);
 const editor=new window.PanoBoxEditor(canvas,b=>changes.push(b),()=>{});editor.ready=true;editor.im={width:1200,height:650};editor.image={};editor.t={scale,tx:40,ty:50};
 editor.boxes=[{id:'original',category:'caries_ungraded',geometry:'lesion_box',bbox:[100.125,100.5,180.75,180.25]}];
 const event=(x,y,button=0)=>({clientX:x,clientY:y,button,pointerId:1,preventDefault(){},target:{tagName:'CANVAS'}});
 return {editor,canvas,events,keys,changes,event};
}
for(const gesture of ['tool','right','middle','space','blank-select'])test('panning via '+gesture+' preserves original pixel boxes, undo state and autosave',()=>{
 for(const scale of [.2,1,2.4]){const h=setup(scale),{editor:e,event}=h,before=JSON.stringify(e.boxes);
 if(gesture==='tool')e.setMode('pan');if(gesture==='space')e.space=true;if(gesture==='blank-select')e.setMode('select');
 const button=gesture==='right'?2:gesture==='middle'?1:0;
 e.down(event(700,500,button));e.move(event(750,470,button));e.up(event(750,470,button));
 assert.equal(e.t.tx,90);assert.equal(e.t.ty,20);assert.equal(JSON.stringify(e.boxes),before);assert.equal(h.changes.length,0);assert.equal(e.history.length,0);assert.equal(h.canvas.capture,null);
 const pixel=e.point(event(20+e.t.tx+100.125*scale,30+e.t.ty+100.5*scale));assert.ok(Math.abs(pixel[0]-100.125)<1e-9);assert.ok(Math.abs(pixel[1]-100.5)<1e-9);
 }
});
test('drawing and undo after panning retain original coordinates at every zoom',()=>{
 for(const scale of [.2,1,2.4]){const h=setup(scale),{editor:e,event}=h;e.setMode('pan');e.down(event(700,500));e.up(event(750,470));e.setMode('draw');
 const at=(x,y)=>event(20+e.t.tx+x*scale,30+e.t.ty+y*scale);e.down(at(300,250));e.up(at(340,290));
 const b=e.boxes.at(-1);for(const [i,x] of [300,250,340,290].entries())assert.ok(Math.abs(b.bbox[i]-x)<1e-9);assert.equal(h.changes.length,1);e.undo();assert.equal(e.boxes.length,1);assert.equal(e.boxes[0].bbox[0],100.125);
 }
});
test('hidden boxes can pan and right-click is consumed by canvas only',()=>{
 const h=setup();let prevented=false;h.events.contextmenu({preventDefault(){prevented=true;}});assert.equal(prevented,true);h.editor.hidden=true;h.editor.down(h.event(400,300));h.editor.up(h.event(450,350));assert.equal(h.editor.t.tx,90);assert.equal(h.changes.length,0);
});
test('switching tools cancels unfinished box without saving a partial annotation',()=>{
 const h=setup();h.editor.down(h.event(400,300));h.editor.move(h.event(450,350));h.editor.setMode('pan');assert.equal(h.editor.boxes.length,1);assert.equal(h.changes.length,0);assert.equal(h.editor.drag,null);assert.equal(h.canvas.style.cursor,'grab');
});

test('AI context cannot be selected, moved or serialized into human answers at any zoom',()=>{
 for(const scale of [.2,1,2.4]){
  const h=setup(scale),e=h.editor,before=JSON.stringify(e.boxes);
  e.aiBoxes=[{id:'ai-context',category:'deep_caries',geometry:'tooth_box',bbox:[300,250,340,290]}];const ai=JSON.stringify(e.aiBoxes);
  e.setMode('select');const at=(x,y)=>h.event(20+e.t.tx+x*scale,30+e.t.ty+y*scale);
  e.down(at(320,270));e.up(at(330,280));assert.equal(e.selected,null);assert.equal(h.changes.length,0);
  e.aiHidden=true;e.paint();e.aiHidden=false;e.paint();e.undo();e.remove();
  assert.equal(JSON.stringify(e.boxes),before);assert.equal(JSON.stringify(e.aiBoxes),ai);assert.equal(e.history.length,0);
 }
});
