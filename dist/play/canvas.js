/* Original-pixel box editor. CSS/device pixel ratio never changes stored coordinates. */
(function(){
const G=window.PanoGame,colors={caries_ungraded:"#f5bf62",deep_caries:"#ff8a97",periapical_lesion:"#b6a0ff",impacted_tooth:"#77dbe5"};
class BoxEditor{
 constructor(canvas,onChange,onSelect){
 this.canvas=canvas;this.ctx=canvas.getContext("2d");this.onChange=onChange;this.onSelect=onSelect;this.boxes=[];this.history=[];this.future=[];this.mode="draw";this.category="caries_ungraded";this.space=false;this.hidden=false;this.t={scale:1,tx:0,ty:0};this.ready=false;
 this.resize=new ResizeObserver(()=>{this.cancel();this.paint();});this.resize.observe(canvas);
 canvas.addEventListener("pointerdown",e=>this.down(e));canvas.addEventListener("pointermove",e=>this.move(e));canvas.addEventListener("pointerup",e=>this.up(e));canvas.addEventListener("pointercancel",()=>this.cancel());
 canvas.addEventListener("wheel",e=>{e.preventDefault();if(!this.ready)return;const p=this.point(e),rect=canvas.getBoundingClientRect(),s=Math.max(.05,Math.min(10,this.t.scale*Math.exp(-e.deltaY*.001)));this.t={scale:s,tx:e.clientX-rect.left-p[0]*s,ty:e.clientY-rect.top-p[1]*s};this.paint();},{passive:false});
 window.addEventListener("blur",()=>{this.space=false;this.cancel();});
 window.addEventListener("keydown",e=>{if(!this.ready||canvas.closest("[hidden]")||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
 if(e.code==="Space"){e.preventDefault();this.space=true;}if(e.key==="Delete"){e.preventDefault();this.remove();}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?this.redo():this.undo();}
 if(e.key.toLowerCase()==="b")this.setMode("draw");if(e.key.toLowerCase()==="v")this.setMode("select");if(e.key.toLowerCase()==="h")this.toggle();
 });
 window.addEventListener("keyup",e=>{if(e.code==="Space")this.space=false;});
 }
 async load(im,boxes){
 this.ready=false;this.im=im;this.boxes=structuredClone(boxes);this.history=[];this.future=[];this.selected=null;this.hidden=false;this.drag=null;const token=Symbol();this.loading=token;
 const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error("영상을 불러오지 못했습니다. 다시 시도하세요."));img.src=im.image_url;});
 if(this.loading!==token)return;
 if(img.naturalWidth!==im.width||img.naturalHeight!==im.height)throw Error("원본 영상 크기가 일치하지 않습니다.");
 this.image=img;this.ready=true;this.fit();this.onSelect(null);
 }
 fit(){if(!this.im)return;const r=this.canvas.getBoundingClientRect();const s=Math.min(r.width/this.im.width,r.height/this.im.height)*.94;this.t={scale:s,tx:(r.width-this.im.width*s)/2,ty:(r.height-this.im.height*s)/2};this.paint();}
 point(e){const r=this.canvas.getBoundingClientRect();return G.toImage(e.clientX,e.clientY,{...this.t,left:r.left,top:r.top});}
 clamp(p){return [Math.min(this.im.width,Math.max(0,p[0])),Math.min(this.im.height,Math.max(0,p[1]))];}
 setMode(m){this.mode=m;document.getElementById("draw-tool")?.classList.toggle("active",m==="draw");document.getElementById("select-tool")?.classList.toggle("active",m==="select");}
 select(id){this.selected=id;this.onSelect(id);this.paint();}
 down(e){
 if(!this.ready||this.locked||e.button!==0)return;this.canvas.focus({preventScroll:true});this.canvas.setPointerCapture(e.pointerId);
 const p=this.clamp(this.point(e));if(this.space){this.drag={kind:"pan",x:e.clientX,y:e.clientY,t:{...this.t}};return;}
 if(this.hidden)return;
 const before=structuredClone(this.boxes);
 if(this.mode==="draw"){
 const b={id:crypto.randomUUID(),category:this.category,geometry:G.geometry[this.category],bbox:[...p,...p]};
 this.boxes.push(b);this.selected=b.id;this.drag={kind:"draw",id:b.id,start:p,before};this.paint();return;
 }
 const hit=[...this.boxes].reverse().find(b=>{const a=b.bbox,pad=8/this.t.scale;return p[0]>=a[0]-pad&&p[0]<=a[2]+pad&&p[1]>=a[1]-pad&&p[1]<=a[3]+pad;});
 if(!hit){this.select(null);return;}
 this.selected=hit.id;const a=hit.bbox,pad=9/this.t.scale,corners=[[a[0],a[1]],[a[2],a[1]],[a[2],a[3]],[a[0],a[3]]],corner=corners.findIndex(c=>Math.abs(c[0]-p[0])<pad&&Math.abs(c[1]-p[1])<pad);
 this.drag={kind:corner<0?"move":"resize",corner,id:hit.id,start:p,original:[...a],before};this.onSelect(hit.id);this.paint();
 }
 move(e){const d=this.drag;if(!d)return;if(d.kind==="pan"){this.t.tx=d.t.tx+e.clientX-d.x;this.t.ty=d.t.ty+e.clientY-d.y;this.paint();return;}
 const p=this.clamp(this.point(e)),b=this.boxes.find(x=>x.id===d.id);if(!b)return;
 if(d.kind==="draw")b.bbox=[Math.min(p[0],d.start[0]),Math.min(p[1],d.start[1]),Math.max(p[0],d.start[0]),Math.max(p[1],d.start[1])];
 if(d.kind==="move"){const a=d.original,dx=Math.min(this.im.width-a[2],Math.max(-a[0],p[0]-d.start[0])),dy=Math.min(this.im.height-a[3],Math.max(-a[1],p[1]-d.start[1]));b.bbox=[a[0]+dx,a[1]+dy,a[2]+dx,a[3]+dy];}
 if(d.kind==="resize"){const a=[...d.original];if(d.corner===0||d.corner===3)a[0]=Math.min(p[0],a[2]-1);else a[2]=Math.max(p[0],a[0]+1);if(d.corner<2)a[1]=Math.min(p[1],a[3]-1);else a[3]=Math.max(p[1],a[1]+1);b.bbox=a;}
 this.paint();
 }
 up(e){const d=this.drag;if(!d)return;this.move(e);this.drag=null;if(d.kind==="pan")return;
 const b=this.boxes.find(x=>x.id===d.id);if(b&&(b.bbox[2]-b.bbox[0]<1||b.bbox[3]-b.bbox[1]<1)){this.boxes=d.before;this.selected=null;this.paint();return;}
 if(JSON.stringify(d.before)!==JSON.stringify(this.boxes)){this.history.push(d.before);this.future=[];this.changed();}this.onSelect(this.selected);this.paint();
 }
 cancel(){if(this.drag?.before)this.boxes=this.drag.before;this.drag=null;this.paint();}
 changed(){this.onChange(structuredClone(this.boxes));this.onSelect(this.selected);}
 remove(){if(!this.selected||!this.ready||this.locked)return;this.history.push(structuredClone(this.boxes));this.future=[];this.boxes=this.boxes.filter(x=>x.id!==this.selected);this.selected=null;this.changed();this.paint();}
 undo(){if(this.locked||!this.history.length)return;this.future.push(structuredClone(this.boxes));this.boxes=this.history.pop();this.selected=null;this.changed();this.paint();}
 redo(){if(this.locked||!this.future.length)return;this.history.push(structuredClone(this.boxes));this.boxes=this.future.pop();this.selected=null;this.changed();this.paint();}
 toggle(){this.hidden=!this.hidden;document.getElementById("hide-boxes").textContent=window.LoDI18n.t(this.hidden?"show":"hide");this.paint();}
 paint(){
 const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return;const dpr=window.devicePixelRatio||1;this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);
 const c=this.ctx;c.setTransform(this.canvas.width/r.width,0,0,this.canvas.height/r.height,0,0);c.fillStyle="#101a17";c.fillRect(0,0,r.width,r.height);if(!this.ready)return;
 c.translate(this.t.tx,this.t.ty);c.scale(this.t.scale,this.t.scale);c.drawImage(this.image,0,0);
 if(this.hidden)return;
 this.boxes.forEach((b,i)=>{const a=b.bbox;c.strokeStyle=colors[b.category];c.lineWidth=(b.id===this.selected?3:2)/this.t.scale;c.strokeRect(a[0],a[1],a[2]-a[0],a[3]-a[1]);c.font=12/this.t.scale+"px sans-serif";c.fillStyle=colors[b.category];c.fillText(String(i+1),a[0]+3/this.t.scale,Math.max(14/this.t.scale,a[1]-4/this.t.scale));if(b.id===this.selected){const z=7/this.t.scale;[[a[0],a[1]],[a[2],a[1]],[a[2],a[3]],[a[0],a[3]]].forEach(p=>c.fillRect(p[0]-z/2,p[1]-z/2,z,z));}});
 }
}
window.PanoBoxEditor=BoxEditor;
})();
