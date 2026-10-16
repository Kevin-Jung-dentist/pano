/* Shared, framework-free package validation and review rules. */
(function(root){
"use strict";
const labels={caries_ungraded:"충치",deep_caries:"깊은 충치",periapical_lesion:"치근단 병소",impacted_tooth:"매복치"};
const colors={caries_ungraded:"#f6b756",deep_caries:"#ff8189",periapical_lesion:"#b99cff",impacted_tooth:"#61cfea"};
const roles={caries_ungraded:"caries",deep_caries:"findings",periapical_lesion:"hanoi",impacted_tooth:"findings"};
const geometry={caries_ungraded:"lesion_box",deep_caries:"tooth_box",periapical_lesion:"lesion_box",impacted_tooth:"tooth_box"};
const clone=x=>JSON.parse(JSON.stringify(x));
const coordinateSystem=Object.freeze({space:"original_image",units:"pixel",bbox:"xyxy",origin:"top_left",max_edge:"exclusive"});
function toImage(x,y,t){return [(x-t.left-t.tx)/t.scale,(y-t.top-t.ty)/t.scale];}
function toScreen(x,y,t){return [x*t.scale+t.tx+t.left,y*t.scale+t.ty+t.top];}
function sameCoordinates(c){return c&&Object.keys(coordinateSystem).every(k=>c[k]===coordinateSystem[k]);}
function boxOK(b,im){
 return !!b && Object.hasOwn(labels,b.category) && b.geometry===geometry[b.category] &&
 Array.isArray(b.bbox) && b.bbox.length===4 && b.bbox.every(Number.isFinite) &&
 b.bbox[0]>=0 && b.bbox[1]>=0 && b.bbox[2]<=im.width && b.bbox[3]<=im.height &&
 b.bbox[0]<b.bbox[2] && b.bbox[1]<b.bbox[3] &&
 ["draft","editing","confirmed","excluded"].includes(b.status);
}
function validate(m){
 if(m.format!=="pano-work"||m.version!==1||typeof m.package_id!=="string"||typeof m.token!=="string"||
 !Array.isArray(m.images)||!m.images.length||m.images.length>200)throw Error("지원하는 Pano 작업 ZIP이 아닙니다.");
 if(m.coordinate_system&&!sameCoordinates(m.coordinate_system))throw Error("지원하지 않는 좌표계입니다.");
 const seen=new Set();
 for(const im of m.images){
  if(typeof im.id!=="string"||seen.has(im.id)||!Number.isInteger(im.width)||!Number.isInteger(im.height)||
    im.width<1||im.height<1||im.width*im.height>100000000||im.file!=="images/"+im.id+".png"||
    !/^[a-zA-Z0-9_-]+$/.test(im.id)||typeof im.base!=="string")throw Error("영상 정보가 잘못되었습니다.");
  seen.add(im.id);const ids=new Set();
  if(!Array.isArray(im.boxes)||im.boxes.length>2000)throw Error("박스 목록 오류");
  for(const b of im.boxes){
   if(typeof b.id!=="string"||ids.has(b.id)||!boxOK(b,im))throw Error("박스 좌표 또는 종류 오류");
   ids.add(b.id);
  }
  if(!im.review||["caries","findings","hanoi"].some(r=>typeof im.review[r]!=="boolean")||typeof im.needs_review!=="boolean")throw Error("검토 상태 오류");
 }
 return m;
}
function edit(im,id,changes){
 const b=im.boxes.find(b=>b.id===id);if(!b)throw Error("박스를 선택하세요.");
 if(b.locked&&changes.bbox)throw Error("원본 정밀 윤곽의 박스는 이동할 수 없습니다.");
 if(changes.category&&changes.category!==b.category)throw Error("기존 박스는 제외 후 올바른 종류로 새로 추가하세요.");
 const next={...b,...changes};
 if(!boxOK(next,im))throw Error("원본 영상 안에 박스를 그려주세요.");
 Object.assign(b,next);im.review[roles[b.category]]=false;im.needs_review=false;
}
function complete(im,role){
 const targets=role==="all"?["caries","findings","hanoi"]:[role];
 if(targets.some(r=>!["caries","findings","hanoi"].includes(r)))throw Error("검토 범위 오류");
 if(im.boxes.some(b=>targets.includes(roles[b.category])&&!["confirmed","excluded"].includes(b.status)))throw Error("해당 소견의 박스를 모두 확정 또는 제외한 뒤 완료하세요.");
 for(const r of targets)im.review[r]=true;im.needs_review=false;
}
function result(m){return {format:"pano-result",version:1,package_id:m.package_id,token:m.token,actor:m.actor,coordinate_system:clone(coordinateSystem),editor_build:m.editor_build||null,exported_at:new Date().toISOString(),images:m.images.map(im=>({id:im.id,base:im.base,boxes:clone(im.boxes),review:clone(im.review),needs_review:im.needs_review,history:clone(im.history||[])}))};}
const api={labels,colors,roles,geometry,clone,validate,boxOK,edit,complete,result,coordinateSystem,toImage,toScreen,sameCoordinates};
if(typeof module!=="undefined")module.exports=api;else root.Pano=api;
})(globalThis);
