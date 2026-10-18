/* Browser/server contract. Original-image pixels; no browser-computed score is trusted. */
(function(root){
"use strict";
const version="lod-score-4",weightedVersion="lod-score-3",previousVersion="lod-score-2";
const scoredVersions=[previousVersion,weightedVersion,version],timedVersions=[weightedVersion,version];
const matchThreshold=.30;
const categories=["caries_ungraded","deep_caries","periapical_lesion","impacted_tooth"];
const labelCategories=["caries_ungraded","periapical_lesion"],aiCategories=["deep_caries","impacted_tooth"],caseSeconds=120;
const referenceCategories=[...labelCategories,"deep_caries"];
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
function legacyGrade(predictions,reference,im,threshold=.3){
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
function legacySummary(items){const scored=items.filter(x=>x.scored);const points=scored.reduce((s,x)=>s+x.grade.points,0);return {points,scored_count:scored.length,unscored_count:items.length-scored.length,average:scored.length?points/scored.length:null};}
// Maximum cardinality first, then maximum total IoU. Hungarian assignment is
// deterministic in score and does not depend on reference/input box order.
function assignment(weights){
 const n=weights.length;if(!n)return [];const u=Array(n+1).fill(0),v=Array(n+1).fill(0),p=Array(n+1).fill(0),way=Array(n+1).fill(0);
 for(let i=1;i<=n;i++){p[0]=i;let j0=0;const min=Array(n+1).fill(Infinity),used=Array(n+1).fill(false);
 do{used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;
 for(let j=1;j<=n;j++)if(!used[j]){const cur=-weights[i0-1][j-1]-u[i0]-v[j];if(cur<min[j]){min[j]=cur;way[j]=j0;}if(min[j]<delta){delta=min[j];j1=j;}}
 for(let j=0;j<=n;j++){if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;}j0=j1;
 }while(p[j0]!==0);
 do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0!==0);
 }return p.slice(1).map((i,j)=>[i-1,j]);
}
function metrics(tp,fp,fn,iou_sum){
 const reference_count=tp+fn,mean_iou=tp?iou_sum/tp:null,recall=reference_count?tp/reference_count:null,precision=tp+fp?tp/(tp+fp):null;
 return {tp,fp,fn,reference_count,iou_sum,mean_iou,recall,precision,score:reference_count?Math.max(0,Math.min(100,100*iou_sum/(reference_count+fp))):null,max_score:100};
}
function gradeV2(predictions,reference,im,threshold=matchThreshold){
 const pred=boxes(predictions,im),ref=boxes(reference,im);
 if(!Number.isFinite(threshold)||threshold<.1||threshold>1)throw Error("채점 기준 오류");
 const groups=[...new Set(reference.map(b=>b.finding_id||b.id))],n=Math.max(pred.length,groups.length);
 const overlaps=pred.map(p=>groups.map(g=>Math.max(0,...ref.map((r,i)=>(reference[i].finding_id||r.id)===g&&p.category===r.category&&p.geometry===r.geometry?iou(p.bbox,r.bbox):0))));
 const weights=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>overlaps[i]?.[j]>=threshold?n+1+overlaps[i][j]:0));
 const pairs=assignment(weights).filter(([i,j])=>overlaps[i]?.[j]>=threshold),matched=new Set(pairs.map(x=>x[0])),found=new Set(pairs.map(x=>x[1]));
 const iou_sum=pairs.reduce((s,[i,j])=>s+overlaps[i][j],0);
 return {...metrics(pairs.length,pred.length-pairs.length,groups.length-pairs.length,iou_sum),points:pairs.length,threshold,rule_version:previousVersion,
 matches:pairs.map(([i,j])=>({box_id:pred[i].id,finding_id:groups[j],iou:overlaps[i][j]})),
 extra:pred.filter((_,i)=>!matched.has(i)).map(b=>b.id),missed:groups.filter((_,j)=>!found.has(j))};
}
function summaryV2(items){
 const scored=items.filter(x=>x.scored);const sums=scored.reduce((a,x)=>{for(const k of ["tp","fp","fn","iou_sum"])a[k]+=x.grade[k];return a;},{tp:0,fp:0,fn:0,iou_sum:0});
 return {...metrics(sums.tp,sums.fp,sums.fn,sums.iou_sum),points:sums.tp,scored_count:scored.length,unscored_count:items.length-scored.length,rule_version:previousVersion};
}
function weightedMetrics(tp,fp,fn,iou_sum,fp_penalty){
 const values=metrics(tp,fp,fn,iou_sum);
 return {...values,fp_penalty,score:values.reference_count?Math.max(0,Math.min(100,100*(iou_sum-fp_penalty)/values.reference_count)):null};
}
function gradeV3(predictions,reference,im,threshold=matchThreshold){
 const result=gradeV2(predictions,reference,im,threshold),extra=new Set(result.extra);
 // One missed perfect match loses one reference point; an extra caries box
 // loses 0.25. Periapical false positives still lose one full point.
 const penalty=predictions.reduce((sum,b)=>sum+(extra.has(b.id)?b.category==='caries_ungraded'?.25:1:0),0);
 return {...result,...weightedMetrics(result.tp,result.fp,result.fn,result.iou_sum,penalty),rule_version:weightedVersion};
}
function summaryV3(items){
 const scored=items.filter(x=>x.scored),sums={tp:0,fp:0,fn:0,iou_sum:0,fp_penalty:0};
 for(const x of scored)for(const k of Object.keys(sums))sums[k]+=x.grade[k];
 return {...weightedMetrics(sums.tp,sums.fp,sums.fn,sums.iou_sum,sums.fp_penalty),points:sums.tp,scored_count:scored.length,unscored_count:items.length-scored.length,rule_version:weightedVersion};
}
const contains=(outer,inner)=>inner[0]>=outer[0]&&inner[1]>=outer[1]&&inner[2]<=outer[2]&&inner[3]<=outer[3];
function referenceGroups(reference){
 // Only grading groups are unified. Original classes, geometries and labels stay intact.
 const keys=reference.map(b=>b.finding_id||b.id),parent=new Map(keys.map(k=>[k,k]));
 const root=k=>{while(parent.get(k)!==k)k=parent.get(k);return k;};
 const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent.set(a,b);};
 const area=b=>(b.bbox[2]-b.bbox[0])*(b.bbox[3]-b.bbox[1]);
 const deep=reference.map((b,i)=>({b,i})).filter(x=>x.b.category==='deep_caries');
 reference.forEach((b,i)=>{if(b.category!=='caries_ungraded')return;
  const enclosing=deep.filter(x=>contains(x.b.bbox,b.bbox)).sort((a,b)=>area(a.b)-area(b.b)||a.b.id.localeCompare(b.b.id));
  if(enclosing.length)join(keys[i],keys[enclosing[0].i]);
 });
 const groups=new Map();reference.forEach((b,i)=>{const key=root(keys[i]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);});
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([id,refs])=>({id,refs}));
}
function v4Metrics(tp,fp,fn,iou_sum,fp_penalty,credit_sum,containment_tp){
 const values=weightedMetrics(tp,fp,fn,credit_sum,fp_penalty),iou_matches=tp-containment_tp;
 return {...values,iou_sum,mean_iou:iou_matches?iou_sum/iou_matches:null,iou_matches,credit_sum,containment_tp};
}
function grade(predictions,reference,im,threshold=matchThreshold){
 if(!Number.isFinite(threshold)||threshold<.1||threshold>1)throw Error("채점 기준 오류");
 const pred=boxes(predictions,im),selected=reference.filter(b=>referenceCategories.includes(b.category));
 boxes(selected,{...im,scope:referenceCategories});
 const groups=referenceGroups(selected),n=Math.max(pred.length,groups.length);
 const edges=pred.map(p=>groups.map(g=>{
  const candidates=g.refs.map(r=>{
   if(p.category==='caries_ungraded'&&r.category==='deep_caries'&&contains(r.bbox,p.bbox))return {credit:1,iou:null,method:'deep_caries_containment',reference_id:r.id};
   if(p.category===r.category&&p.geometry===r.geometry){const overlap=iou(p.bbox,r.bbox);if(overlap>=threshold)return {credit:overlap,iou:overlap,method:'iou',reference_id:r.id};}
   return null;
  }).filter(Boolean).sort((a,b)=>b.credit-a.credit||a.method.localeCompare(b.method)||a.reference_id.localeCompare(b.reference_id));
  return candidates[0]||null;
 }));
 const weights=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>edges[i]?.[j]?n+1+edges[i][j].credit:0));
 const pairs=assignment(weights).filter(([i,j])=>edges[i]?.[j]),matched=new Set(pairs.map(x=>x[0])),found=new Set(pairs.map(x=>x[1]));
 const matches=pairs.map(([i,j])=>({box_id:pred[i].id,finding_id:groups[j].id,...edges[i][j]}));
 const extra=pred.filter((_,i)=>!matched.has(i)),penalty=extra.reduce((sum,b)=>sum+(b.category==='caries_ungraded'?.25:1),0);
 const credit=matches.reduce((s,m)=>s+m.credit,0),iou_sum=matches.reduce((s,m)=>s+(m.iou??0),0),contained=matches.filter(m=>m.method==='deep_caries_containment').length;
 return {...v4Metrics(pairs.length,extra.length,groups.length-pairs.length,iou_sum,penalty,credit,contained),points:pairs.length,threshold,rule_version:version,matches,extra:extra.map(b=>b.id),missed:groups.filter((_,j)=>!found.has(j)).map(g=>g.id)};
}
function summary(items){
 const scored=items.filter(x=>x.scored),sums={tp:0,fp:0,fn:0,iou_sum:0,fp_penalty:0,credit_sum:0,containment_tp:0};
 for(const x of scored)for(const k of Object.keys(sums))sums[k]+=x.grade[k];
 return {...v4Metrics(sums.tp,sums.fp,sums.fn,sums.iou_sum,sums.fp_penalty,sums.credit_sum,sums.containment_tp),points:sums.tp,scored_count:scored.length,unscored_count:items.length-scored.length,rule_version:version};
}
const gradeFor=(rule,...args)=>rule===version?grade(...args):rule===weightedVersion?gradeV3(...args):rule===previousVersion?gradeV2(...args):legacyGrade(...args);
const summaryFor=(rule,items)=>rule===version?summary(items):rule===weightedVersion?summaryV3(items):summaryV2(items);
function toImage(x,y,t){return [(x-t.left-t.tx)/t.scale,(y-t.top-t.ty)/t.scale];}
const api={version,weightedVersion,previousVersion,scoredVersions,timedVersions,labelCategories,referenceCategories,aiCategories,caseSeconds,gradeFor,summaryFor,gradeV2,summaryV2,gradeV3,summaryV3,matchThreshold,metrics,legacyGrade,legacySummary,categories,geometry,coordinateSystem,countryCodes,profile,boxes,iou,grade,summary,toImage};
if(typeof module!=="undefined")module.exports=api;else root.PanoGame=api;
})(globalThis);
