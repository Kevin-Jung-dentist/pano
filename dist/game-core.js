/* Browser/server contract. Original-image pixels; no browser-computed score is trusted. */
(function(root){
"use strict";
const version="pano-game-1";
const categories=["caries_ungraded","deep_caries","periapical_lesion","impacted_tooth"];
const geometry={caries_ungraded:"lesion_box",deep_caries:"tooth_box",periapical_lesion:"lesion_box",impacted_tooth:"tooth_box"};
const coordinateSystem={space:"original_image",units:"pixel",bbox:"xyxy",origin:"top_left",max_edge:"exclusive"};
const countryCodes="AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
function cleanText(v,min,max,name){if(typeof v!=="string")throw Error(name+"을 입력하세요.");const s=v.normalize("NFKC").trim().replace(/\s+/g," ");if(s.length<min||s.length>max||/[\u0000-\u001f\u007f<>]/u.test(s))throw Error(name+" 형식을 확인하세요.");return s;}
function profile(p){return {nickname:cleanText(p.nickname,2,24,"닉네임"),country:countryCodes.includes(p.country)?p.country:(()=>{throw Error("국가를 선택하세요.");})(),university:cleanText(p.university,2,120,"대학 또는 소속")};}
function boxes(input,im){
 if(!Array.isArray(input)||input.length>128)throw Error("박스는 영상당 최대 128개입니다.");
 const ids=new Set();return input.map(b=>{if(!b||typeof b.id!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(b.id)||ids.has(b.id))throw Error("박스 ID 오류");ids.add(b.id);
 if(!categories.includes(b.category)||!(im.scope||categories).includes(b.category)||b.geometry!==geometry[b.category]||!Array.isArray(b.bbox)||b.bbox.length!==4||!b.bbox.every(Number.isFinite))throw Error("병소 종류 또는 좌표 오류");
 const [x1,y1,x2,y2]=b.bbox;if(x1<0||y1<0||x2>im.width||y2>im.height||x2<=x1||y2<=y1)throw Error("원본 영상 안에 박스를 그려주세요.");
 return {id:b.id,category:b.category,geometry:b.geometry,bbox:[...b.bbox]};
 });
}
function iou(a,b){const area=r=>(r[2]-r[0])*(r[3]-r[1]);const i=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));return i/(area(a)+area(b)-i);}
function grade(predictions,reference,im,threshold=.3){
 const pred=boxes(predictions,im),ref=boxes(reference,im);
 if(!Number.isFinite(threshold)||threshold<.1||threshold>1)throw Error("채점 기준 오류");
 // Multiple acceptable annotations of one physical finding share finding_id.
 const groups=[...new Set(reference.map(b=>b.finding_id||b.id))];
 const edges=pred.map(p=>groups.map((g,gi)=>({gi,overlap:Math.max(0,...ref.map((r,i)=>(reference[i].finding_id||r.id)===g&&p.category===r.category&&p.geometry===r.geometry?iou(p.bbox,r.bbox):0))})).filter(x=>x.overlap>=threshold).sort((a,b)=>b.overlap-a.overlap).map(x=>x.gi));
 const owner=new Map();function match(pi,seen){for(const gi of edges[pi]){if(seen.has(gi))continue;seen.add(gi);if(!owner.has(gi)||match(owner.get(gi),seen)){owner.set(gi,pi);return true;}}return false;}
 for(let pi=0;pi<pred.length;pi++)match(pi,new Set());
 const matched=new Set(owner.values());
 return {points:owner.size,tp:owner.size,fp:pred.length-owner.size,fn:groups.length-owner.size,threshold,
 matches:[...owner].map(([gi,pi])=>({box_id:pred[pi].id,finding_id:groups[gi]})),
 extra:pred.filter((_,i)=>!matched.has(i)).map(b=>b.id),missed:groups.filter((_,i)=>!owner.has(i))};
}
function summary(items){const scored=items.filter(x=>x.scored);const points=scored.reduce((s,x)=>s+x.grade.points,0);return {points,scored_count:scored.length,unscored_count:items.length-scored.length,average:scored.length?points/scored.length:null};}
function toImage(x,y,t){return [(x-t.left-t.tx)/t.scale,(y-t.top-t.ty)/t.scale];}
const api={version,categories,geometry,coordinateSystem,countryCodes,profile,boxes,iou,grade,summary,toImage};
if(typeof module!=="undefined")module.exports=api;else root.PanoGame=api;
})(globalThis);
