/* All annotation state stays local. No fetch, analytics, or model requests. */
"use strict";
const $=id=>document.getElementById(id),P=globalThis.Pano;
let work=null,zip=null,index=0,selected=null,picture=null,pictureURL=null,loadEpoch=0,mode="select",hidden=false;
let scale=1,tx=0,ty=0,drag=null,space=false,undo=[],redo=[],db=null,saveQueue=Promise.resolve(),exportDirty=false;
const canvas=$("canvas"),ctx=canvas.getContext("2d");
const current=()=>work?.images[index];
const stateName={draft:"AI 초안",editing:"수정 중",confirmed:"확정",excluded:"제외"};
function message(s){$("notice").textContent=s;$("notice").hidden=!s;}
function catchError(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>message(e.message||String(e)));}
function done(im){return Object.values(im.review).every(Boolean)&&!im.needs_review;}
function initDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open("pano-collab-v1",1);q.onupgradeneeded=()=>q.result.createObjectStore("work");q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function cacheGet(key){if(!db)db=await initDB();return new Promise((resolve,reject)=>{const t=db.transaction("work"),q=t.objectStore("work").get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function cachePut(data){if(!db)db=await initDB();return new Promise((resolve,reject)=>{const t=db.transaction("work","readwrite");t.objectStore("work").put(data,data.package_id);t.oncomplete=resolve;t.onabort=()=>reject(t.error||Error("저장 실패"));t.onerror=()=>reject(t.error);});}
function save(){
 exportDirty=true;const copy=P.clone(work);$("save-status").textContent="저장 중…";
 saveQueue=saveQueue.catch(()=>{}).then(()=>cachePut(copy)).then(()=>{$("save-status").textContent="이 기기에 저장됨 · "+new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});},e=>{$("save-status").textContent="자동 저장 실패";message("자동 저장에 실패했습니다. 수정 내용은 화면에 남아 있습니다. 결과 내보내기로 바로 백업하세요. "+e.message);});
 return saveQueue;
}
function record(action,before){
 const im=current();undo.push(before);if(undo.length>60)undo.shift();redo=[];
 im.history=im.history||[];im.history.push({action,at:new Date().toISOString(),boxes:im.boxes.filter(b=>{const old=before.boxes.find(x=>x.id===b.id);return !old||JSON.stringify(old)!==JSON.stringify(b)}).map(P.clone),review:P.clone(im.review)});
 renderLists();draw();save();
}
function mutate(action,fn){if(!work)return;const before=P.clone(current());try{fn(current());record(action,before);}catch(e){work.images[index]=before;throw e;}}
function restoreResult(r){
 if(r.format!=="pano-result"||r.version!==1||r.package_id!==work.package_id||r.token!==work.token)throw Error("현재 작업의 결과 파일이 아닙니다.");
 const seen=new Set(),updates=[];
 for(const x of r.images){
  const im=work.images.find(v=>v.id===x.id);if(!im||im.base!==x.base||seen.has(x.id))throw Error("원본 영상 버전 불일치");seen.add(x.id);
  const next={...im,boxes:x.boxes,review:x.review,needs_review:x.needs_review,history:x.history||[]};
  P.validate({...work,images:[next]});
  const old=new Map(im.boxes.map(b=>[b.id,b]));
  for(const b of next.boxes){const o=old.get(b.id);if(o&&(o.category!==b.category||o.geometry!==b.geometry||(o.locked&&JSON.stringify(o.bbox)!==JSON.stringify(b.bbox))))throw Error("원본 라벨 변경 오류");}
  if([...old.keys()].some(id=>!next.boxes.some(b=>b.id===id)))throw Error("기존 박스가 누락된 결과입니다.");
  if(next.boxes.some(b=>next.review[P.roles[b.category]]&&!["confirmed","excluded"].includes(b.status)))throw Error("미확정 박스가 있는 검토 완료 상태입니다.");
  updates.push([work.images.indexOf(im),next]);
 }
 for(const [i,x]of updates)work.images[i]=x;
}
async function openFile(file){
 if(!file)return;
 if(exportDirty&&!confirm("현재 수정 결과를 내보냈나요? 다른 작업을 열어도 자동 저장본은 남지만, 결과 파일 백업을 권합니다."))return;
 await saveQueue;message("");$("save-status").textContent="ZIP 확인 중…";
 const nextZip=await PanoZip.open(file),next=P.validate(await nextZip.json("labels.json"));
 for(const im of next.images)if(!nextZip.entries.has(im.file))throw Error("영상 파일이 빠진 ZIP입니다.");
 let cached=null;try{cached=await cacheGet(next.package_id);}catch(e){message("브라우저 자동 저장을 사용할 수 없습니다. 결과를 자주 내보내 주세요.");}
 if(cached&&cached.token===next.token&&cached.images.every(im=>next.images.some(x=>x.id===im.id&&x.base===im.base))){
  const previous=work;work=next;try{restoreResult(P.result(cached));}catch(e){work=previous;throw e;}message("이 브라우저에 저장된 수정 작업을 복원했습니다.");
 }else work=next;
 zip=nextZip;index=0;exportDirty=false;showWorkspace();await loadImage();
}
function showWorkspace(){
 $("welcome").hidden=true;$("workspace").hidden=false;$("workspace-footer").hidden=false;$("export").disabled=false;
 $("assignment").textContent=work.actor+"님의 작업";$("package-id").textContent="작업 "+work.package_id.slice(0,10);
 $("save-status").textContent="작업 파일 열림";renderLists();resize();
}
async function loadImage(){
 const epoch=++loadEpoch;selected=null;undo=[];redo=[];picture=null;drag=null;$("loading").hidden=false;renderLists();draw();
 try{
  const im=current();let blob;
  if(work.demo){
   const c=document.createElement("canvas");c.width=im.width;c.height=im.height;const g=c.getContext("2d");g.fillStyle="#26343b";g.fillRect(0,0,c.width,c.height);
   g.strokeStyle="#72858c";g.lineWidth=4;
   for(let n=0;n<16;n++){const x=80+n*70,y=110+Math.abs(n-7.5)*9;g.beginPath();g.roundRect(x,y,40,130,15);g.stroke();g.beginPath();g.roundRect(x,y+180,40,120,14);g.stroke();}
   g.fillStyle="#d3dfe2";g.font="22px sans-serif";g.fillText("기능 연습 · 실제 치과 영상이 아닙니다",60,55);blob=await new Promise(r=>c.toBlob(r));
  }else blob=new Blob([await zip.bytes(im.file)],{type:"image/png"});
  const url=URL.createObjectURL(blob),img=new Image();
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error("영상을 열 수 없습니다."));img.src=url;});
  if(epoch!==loadEpoch){URL.revokeObjectURL(url);return;}
  if(img.naturalWidth!==im.width||img.naturalHeight!==im.height){URL.revokeObjectURL(url);throw Error("원본 해상도와 영상 크기가 다릅니다.");}
  if(pictureURL)URL.revokeObjectURL(pictureURL);pictureURL=url;picture=img;fit();
 }finally{if(epoch===loadEpoch)$("loading").hidden=true;}
}
function renderLists(){
 if(!work)return;const im=current(),n=work.images.filter(done).length;
 $("progress").textContent=n+" / "+work.images.length+"장 전체 검토 완료";$("progressbar").value=100*n/work.images.length;
 $("image-name").textContent=im.name;$("image-meta").textContent=im.source+" · "+im.split+" · "+im.width+" × "+im.height;
 $("cases").replaceChildren();
 const search=$("search").value.toLowerCase(),filter=$("filter").value;
 work.images.forEach((v,i)=>{
  if(!v.name.toLowerCase().includes(search)||(filter==="pending"&&done(v))||(filter==="done"&&!done(v))||(filter==="flag"&&!v.needs_review))return;
  const b=document.createElement("button");b.className="case-row"+(index===i?" active":"");b.setAttribute("aria-current",index===i?"true":"false");
  const num=document.createElement("span");num.className="number";num.textContent=String(i+1).padStart(2,"0");
  const name=document.createElement("span");name.className="name";name.textContent=v.name;
  const small=document.createElement("small");small.textContent=v.needs_review?"추가 검토 필요":done(v)?"모든 소견 완료":Object.values(v.review).filter(Boolean).length+" / 3 검토 범위 완료";name.append(small);
  const tick=document.createElement("span");tick.className="tick";tick.textContent=v.needs_review?"?":done(v)?"✓":"·";b.append(num,name,tick);
  b.onclick=catchError(()=>navigate(i));$("cases").append(b);
 });
 $("boxes").replaceChildren();$("box-count").textContent=im.boxes.filter(b=>b.status!=="excluded").length;
 im.boxes.forEach((b,i)=>{
  const row=document.createElement("button");row.className="box-row"+(selected===b.id?" active":"")+(b.status==="excluded"?" excluded":"");
  row.style.setProperty("--color",P.colors[b.category]);row.textContent=(i+1)+". "+P.labels[b.category];
  const state=document.createElement("span");state.className="state";state.textContent=stateName[b.status];row.append(state);
  const sub=document.createElement("small");sub.textContent=(b.geometry==="tooth_box"?"치아 전체":"병소 범위")+" · "+(b.locked?"정밀 원본 · 위치 잠김":b.source==="prediction"||b.source==="caries_ai"?"AI 제안":b.source||"직접 추가")+(Number.isFinite(b.confidence)?" · "+Math.round(b.confidence*100)+"%":"");
  row.append(sub);row.onclick=()=>{selected=b.id;renderLists();draw();};$("boxes").append(row);
 });
 const b=im.boxes.find(b=>b.id===selected);
 $("selection").textContent=b?P.labels[b.category]+" · "+stateName[b.status]:"박스를 선택하거나 새로 추가하세요.";
 $("instruction").textContent=b?.locked?"정밀 원본 윤곽의 위치는 보존됩니다. 잘못된 라벨은 제외 후 새 박스를 추가하세요.":((b?.geometry||P.geometry[$("category").value])==="tooth_box"?"해당 치아 전체를 감싸세요. 치관부터 치근 끝까지 포함합니다.":"병소 전체를 포함하는 작은 박스로 표시하세요. 정밀 윤곽을 그릴 필요는 없습니다.");
 $("confirm").disabled=!b;$("exclude").disabled=!b;$("undo").disabled=!undo.length;$("redo").disabled=!redo.length;
 document.querySelectorAll("[data-role]").forEach(el=>{const is=im.review[el.dataset.role];el.classList.toggle("done",is);el.setAttribute("aria-pressed",String(is));el.textContent=({caries:"충치",findings:"매복치·깊은 충치",hanoi:"치근단 병소"}[el.dataset.role])+" 검토 완료"+(is?" ✓":"");});
 $("flag").textContent=im.needs_review?"추가 검토 요청됨 ✓":"판단이 어려워요 · 추가 검토 요청";
}
async function navigate(i){if(!work||i<0||i>=work.images.length)return;index=i;await loadImage();}
function resize(){const r=$("viewport").getBoundingClientRect();if(r.width<1||r.height<1)return;canvas.width=Math.round(r.width*devicePixelRatio);canvas.height=Math.round(r.height*devicePixelRatio);if(picture)fit();else draw();}
function fit(){if(!picture)return;const r=canvas.getBoundingClientRect();scale=Math.min((r.width-40)/picture.width,(r.height-55)/picture.height);tx=(r.width-picture.width*scale)/2;ty=(r.height-picture.height*scale)/2;draw();}
function draw(){
 const r=canvas.getBoundingClientRect();ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.clearRect(0,0,r.width,r.height);if(!picture)return;
 ctx.save();ctx.translate(tx,ty);ctx.scale(scale,scale);ctx.drawImage(picture,0,0);
 if(!hidden){for(const b of current().boxes){if(b.status==="excluded")continue;const [x,y,x2,y2]=b.bbox;const color=P.colors[b.category];ctx.strokeStyle=color;ctx.lineWidth=(b.id===selected?2.5:1.5)/scale;ctx.fillStyle=color+"18";ctx.fillRect(x,y,x2-x,y2-y);ctx.setLineDash(b.status==="draft"?[5/scale,4/scale]:[]);ctx.strokeRect(x,y,x2-x,y2-y);ctx.setLineDash([]);
 ctx.font=11/scale+"px sans-serif";const title=P.labels[b.category]+(b.status==="confirmed"?" ✓":"");const w=ctx.measureText(title).width+10/scale;ctx.fillStyle=color;ctx.fillRect(x,Math.max(0,y-19/scale),w,18/scale);ctx.fillStyle="#111e25";ctx.fillText(title,x+5/scale,Math.max(12/scale,y-6/scale));
 if(b.id===selected&&!b.locked){for(const[a,c]of [[x,y],[x2,y],[x,y2],[x2,y2]]){ctx.fillStyle="#fff";ctx.fillRect(a-4/scale,c-4/scale,8/scale,8/scale);}}
 }}
 if(drag?.type==="new"){const [x,y]=drag.start,[a,b]=drag.end;ctx.strokeStyle=P.colors[$("category").value];ctx.lineWidth=2/scale;ctx.setLineDash([4/scale,3/scale]);ctx.strokeRect(x,y,a-x,b-y);}
 ctx.restore();
}
function point(e){const r=canvas.getBoundingClientRect();return [(e.clientX-r.left-tx)/scale,(e.clientY-r.top-ty)/scale];}
function clampPoint(p){const im=current();return [Math.max(0,Math.min(im.width,p[0])),Math.max(0,Math.min(im.height,p[1]))];}
canvas.addEventListener("pointerdown",e=>{
 if(!picture)return;canvas.focus();canvas.setPointerCapture(e.pointerId);const p=clampPoint(point(e));message("");
 if(space||e.button===1){drag={type:"pan",start:[e.clientX,e.clientY],old:[tx,ty]};return;}
 if(e.button!==0)return;
 if(mode==="draw"){drag={type:"new",start:p,end:p,before:P.clone(current())};return;}
 let b=current().boxes.find(b=>b.id===selected),corner=-1;
 if(b&&!hidden&&!b.locked){const[x,y,a,c]=b.bbox;corner=[[x,y],[a,y],[x,c],[a,c]].findIndex(v=>Math.hypot(v[0]-p[0],v[1]-p[1])*scale<10);}
 if(corner<0)b=hidden?null:[...current().boxes].reverse().find(b=>b.status!=="excluded"&&p[0]>=b.bbox[0]&&p[0]<=b.bbox[2]&&p[1]>=b.bbox[1]&&p[1]<=b.bbox[3]);
 selected=b?.id||null;renderLists();draw();
 if(b&&!b.locked)drag={type:corner>=0?"resize":"move",corner,start:p,original:[...b.bbox],before:P.clone(current()),id:b.id};
});
canvas.addEventListener("pointermove",e=>{
 if(!picture)return;const p=clampPoint(point(e));$("coords").textContent=Math.round(p[0])+", "+Math.round(p[1])+" px";
 if(!drag)return;
 if(drag.type==="pan"){tx=drag.old[0]+e.clientX-drag.start[0];ty=drag.old[1]+e.clientY-drag.start[1];}
 else if(drag.type==="new")drag.end=p;
 else{
  const b=current().boxes.find(b=>b.id===drag.id),o=drag.original,im=current();let xy;
  if(drag.type==="move"){const dx=Math.max(-o[0],Math.min(im.width-o[2],p[0]-drag.start[0])),dy=Math.max(-o[1],Math.min(im.height-o[3],p[1]-drag.start[1]));xy=[o[0]+dx,o[1]+dy,o[2]+dx,o[3]+dy];}
  else{xy=[...o];if(drag.corner===0){xy[0]=Math.min(p[0],o[2]-1);xy[1]=Math.min(p[1],o[3]-1);}if(drag.corner===1){xy[2]=Math.max(p[0],o[0]+1);xy[1]=Math.min(p[1],o[3]-1);}if(drag.corner===2){xy[0]=Math.min(p[0],o[2]-1);xy[3]=Math.max(p[1],o[1]+1);}if(drag.corner===3){xy[2]=Math.max(p[0],o[0]+1);xy[3]=Math.max(p[1],o[1]+1);}}
  b.bbox=xy;
 }draw();
});
canvas.addEventListener("pointerup",catchError(()=>{
 if(!drag)return;const d=drag;drag=null;if(d.type==="pan")return;
 if(d.type==="new"){
  const a=d.start,b=d.end;if(Math.abs(a[0]-b[0])<2||Math.abs(a[1]-b[1])<2){draw();return;}
  const category=$("category").value,id="new:"+crypto.randomUUID();
  mutate("add_box",im=>{im.boxes.push({id,category,geometry:P.geometry[category],bbox:[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])],status:"editing",source:"user",locked:false});im.review[P.roles[category]]=false;im.needs_review=false;selected=id;});
 }else{
  const b=current().boxes.find(b=>b.id===d.id);
  if(JSON.stringify(b.bbox)!==JSON.stringify(d.original)){b.status="editing";current().review[P.roles[b.category]]=false;current().needs_review=false;record("resize_or_move",d.before);}else draw();
 }
}));
canvas.addEventListener("pointercancel",()=>{if(drag?.before)work.images[index]=drag.before;drag=null;draw();});
function zoom(f,x,y){if(!picture)return;const r=canvas.getBoundingClientRect();x=x??r.width/2;y=y??r.height/2;const next=Math.min(10,Math.max(.03,scale*f));tx=x-(x-tx)*next/scale;ty=y-(y-ty)*next/scale;scale=next;draw();}
canvas.addEventListener("wheel",e=>{e.preventDefault();const r=canvas.getBoundingClientRect();zoom(e.deltaY<0?1.12:1/1.12,e.clientX-r.left,e.clientY-r.top);},{passive:false});
function setMode(value){mode=value;$("select-tool").classList.toggle("active",mode==="select");$("draw-tool").classList.toggle("active",mode==="draw");}
function travel(back){
 const src=back?undo:redo,dst=back?redo:undo;if(!src.length)return;const prev=src.pop(),im=current();
 dst.push(P.clone(im));prev.history=[...(im.history||[]),{action:back?"undo":"redo",at:new Date().toISOString(),boxes:P.clone(prev.boxes),review:P.clone(prev.review)}];
 work.images[index]=prev;if(!prev.boxes.some(b=>b.id===selected))selected=null;renderLists();draw();save();
}
async function exportResult(){
 if(!work)return;await saveQueue;const result=P.result(work);
 const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:"application/json"})),a=document.createElement("a");
 a.href=url;a.download="pano-"+work.package_id.slice(0,10)+"-"+new Date().toISOString().replace(/[:.]/g,"-")+".pano-result.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);exportDirty=false;
 message("수정 결과를 다운로드했습니다. 이 JSON 파일을 작업을 배정한 분에게 보내세요.");
}
$("open").onclick=$("welcome-open").onclick=()=>{$("file").value="";$("file").click();};
$("file").onchange=catchError(e=>openFile(e.target.files[0]));
$("dropzone").onclick=()=>$("open").click();$("dropzone").onkeydown=e=>{if(e.key==="Enter"||e.key===" ")$("open").click();};
$("dropzone").ondragover=e=>{e.preventDefault();};$("dropzone").ondrop=catchError(e=>{e.preventDefault();return openFile(e.dataTransfer.files[0]);});
$("export").onclick=catchError(exportResult);
$("restore").onclick=()=>{$("restore-file").value="";$("restore-file").click();};
$("restore-file").onchange=catchError(async e=>{const file=e.target.files[0];if(!file)return;if(file.size>40_000_000)throw Error("결과 파일이 너무 큽니다.");restoreResult(JSON.parse(await file.text()));save();await loadImage();message("결과 파일을 복원했습니다.");});
$("prev").onclick=catchError(()=>navigate(index-1));$("next").onclick=catchError(()=>navigate(index+1));
$("search").oninput=renderLists;$("filter").onchange=renderLists;$("category").onchange=renderLists;
$("select-tool").onclick=()=>setMode("select");$("draw-tool").onclick=()=>setMode("draw");
$("confirm").onclick=catchError(()=>mutate("confirm",im=>P.edit(im,selected,{status:"confirmed"})));
$("exclude").onclick=catchError(()=>mutate("exclude",im=>P.edit(im,selected,{status:"excluded"})));
$("undo").onclick=()=>travel(true);$("redo").onclick=()=>travel(false);
$("fit").onclick=fit;$("zoom-in").onclick=()=>zoom(1.25);$("zoom-out").onclick=()=>zoom(.8);
$("hide").onclick=()=>{hidden=!hidden;$("hide").textContent=hidden?"박스 표시 H":"박스 숨기기 H";$("hide").setAttribute("aria-pressed",String(hidden));draw();};
document.querySelectorAll("[data-role]").forEach(el=>el.onclick=catchError(()=>mutate("complete_"+el.dataset.role,im=>P.complete(im,el.dataset.role))));
$("finish").onclick=catchError(async()=>{mutate("complete_all",im=>P.complete(im,"all"));await saveQueue;if(index<work.images.length-1)await navigate(index+1);else message("마지막 영상입니다. 수정 결과를 내보내 담당자에게 보내세요.");});
$("flag").onclick=catchError(()=>mutate("needs_review",im=>{im.needs_review=true;for(const r of Object.keys(im.review))im.review[r]=false;}));
document.addEventListener("keydown",e=>{
 if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(!work)return;
 if(e.code==="Space"){e.preventDefault();space=true;}if(e.key.toLowerCase()==="b")setMode("draw");if(e.key.toLowerCase()==="v")setMode("select");
 if(e.key.toLowerCase()==="h")$("hide").click();
 if(e.key==="Enter"&&!e.ctrlKey)$("confirm").click();if(e.key==="Delete")$("exclude").click();
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();travel(!e.shiftKey);}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();exportResult();}
 if(e.key==="Escape"&&drag){if(drag.before)work.images[index]=drag.before;drag=null;renderLists();draw();}
});
document.addEventListener("keyup",e=>{if(e.code==="Space")space=false;});
window.addEventListener("blur",()=>{space=false;if(drag?.before){work.images[index]=drag.before;drag=null;draw();}});
window.addEventListener("beforeunload",e=>{if(exportDirty){e.preventDefault();e.returnValue="";}});
new ResizeObserver(resize).observe($("viewport"));
$("demo").onclick=catchError(async()=>{
 work=P.validate({format:"pano-work",version:1,package_id:"demo-practice",token:"synthetic-only",actor:"연습",demo:true,images:[
 {id:"demo1",name:"기능 연습용 도형.png",source:"합성 예제",split:"train",width:1280,height:600,file:"images/demo1.png",base:"synthetic",boxes:[
 {id:"a:demo1",category:"impacted_tooth",geometry:"tooth_box",bbox:[70,160,130,320],status:"draft",source:"prediction",locked:false},
 {id:"c:demo2",category:"caries_ungraded",geometry:"lesion_box",bbox:[575,150,605,185],status:"draft",source:"caries_ai",locked:false}
 ],review:{caries:false,findings:false,hanoi:false},needs_review:false}
 ]});zip=null;index=0;showWorkspace();message("기능 연습 화면입니다. 실제 영상이나 모델 성능 예제가 아닙니다.");await loadImage();
});
