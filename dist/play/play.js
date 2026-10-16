"use strict";
const G=window.PanoGame,$=id=>document.getElementById(id),names={caries_ungraded:"충치",deep_caries:"깊은 충치",periapical_lesion:"치근단 병소",impacted_tooth:"매복치"};
let config={scored:6,total:10},me=null,round=null,current=null,practice=false,group="individual",saving=Promise.resolve(),saveError=null,dirty=false,submitting=false;
function notice(message){$("notice").textContent=message;$("notice").hidden=!message;}
async function api(path,body){const response=await fetch("/api/"+path,{credentials:"same-origin",headers:body?{"Content-Type":"application/json"}:{},method:body?"POST":"GET",body:body?JSON.stringify(body):undefined});let data;try{data=await response.json();}catch{throw Error("서버 응답을 확인할 수 없습니다.");}if(!response.ok)throw Error(data.error||"요청에 실패했습니다.");return data;}
function panel(id){for(const p of ["landing","profile-panel","game-panel","results-panel"])$(p).hidden=p!==id;$("ranking-panel").hidden=id==="game-panel"||id==="profile-panel";window.scrollTo(0,0);}
function keyFor(c){return "pano-game:"+me?.id+":"+round?.id+":"+c.id;}
function cache(c,boxes,pending){if(practice)return;try{localStorage.setItem(keyFor(c),JSON.stringify({boxes,revision:c.revision,pending}));}catch{notice("이 브라우저의 임시 저장 공간이 부족합니다. 서버 저장 상태를 확인하세요.");}}
function changed(boxes){
 if(!current)return;current.boxes=boxes;renderAnswers();
 if(practice){$("draft-status").textContent="연습 · 점수 미반영";return;}
 const c=current,rid=round.id,localKey=keyFor(c);cache(c,boxes,true);dirty=true;$("draft-status").textContent="서버에 저장 중…";
 saving=saving.catch(()=>{}).then(async()=>{try{const s=await api("rounds/"+rid+"/cases/"+c.id+"/draft",{boxes,revision:c.revision,coordinate_system:G.coordinateSystem});c.revision=s.revision;if(round.id===rid)saveError=null;if(JSON.stringify(c.boxes)===JSON.stringify(boxes)){try{localStorage.setItem(localKey,JSON.stringify({boxes,revision:c.revision,pending:false}));}catch{}if(round.id===rid){dirty=false;$("draft-status").textContent="서버에 저장됨";}}}catch(e){if(round.id===rid){saveError=e;dirty=true;$("draft-status").textContent="저장 실패 · 현재 창에 작업 유지";notice(e.message);}}});
}
const editor=new PanoBoxEditor($("canvas"),changed,()=>renderAnswers());
function renderAnswers(){
 $("answer-list").replaceChildren();const boxes=editor.boxes;$("answer-count").textContent=boxes.length;
 boxes.forEach((b,i)=>{const btn=document.createElement("button");btn.className="answer-row"+(editor.selected===b.id?" selected":"");btn.textContent=(i+1)+". "+names[b.category];const small=document.createElement("small");small.textContent=b.bbox.map(x=>x.toFixed(1)).join(", ");btn.append(small);btn.onclick=()=>{editor.setMode("select");editor.select(b.id);};$("answer-list").append(btn);});
 $("remove-box").disabled=!editor.selected||submitting;
}
async function refreshMe(){const result=await api("me");me=result.user;$("account").hidden=!me;$("account").textContent=me?.nickname||"프로필 설정";$("login-top").hidden=!!me;$("start").textContent=me?"판독 시작하기 →":"Google 로그인으로 시작 →";}
function fillProfile(){
 if(!me)return;panel("profile-panel");$("nickname").value=me.nickname||"";$("country").value=me.country||"";$("university").value=me.university||"";$("terms").checked=me.profile_complete;
}
async function begin(){await saving;notice("");if(!me){if(!config.auth_ready){notice("Google 로그인 연결을 준비하고 있습니다. 조작 연습은 바로 이용할 수 있습니다.");return;}location.assign("/api/auth/start");return;}if(!me.profile_complete){fillProfile();return;}
 try{$("start").disabled=true;practice=false;round=await api("rounds",{});await showNext();}catch(e){notice(e.message);}finally{$("start").disabled=false;}}
async function showNext(){
 if(round.state==="complete"){await showResults();return;}
 current=round.items.find(x=>!x.submitted);if(!current)throw Error("진행 중인 영상을 찾을 수 없습니다.");
 panel("game-panel");$("case-title").textContent="영상 "+(current.position+1)+" / "+round.total_target;$("round-label").textContent=practice?"PRACTICE · 합성 도형":"READING ROUND";
 $("attribution").textContent=current.attribution+" · "+current.license;$("draft-status").textContent="영상을 불러오는 중…";$("submit").disabled=true;$("skip").disabled=true;
 for(const opt of $("finding").options)opt.hidden=!current.scope.includes(opt.value);$("finding").value=current.scope[0];editor.category=current.scope[0];
 let restored=false;
 if(!practice){try{const saved=JSON.parse(localStorage.getItem(keyFor(current))||"null");if(saved?.pending){if(saved.revision===current.revision){current.boxes=G.boxes(saved.boxes,current);restored=true;}else notice("다른 창의 저장본과 충돌하여 서버의 답을 불러왔습니다. 이 기기의 임시본은 보존했습니다.");}}catch{notice("이 기기의 임시본을 읽지 못해 서버 저장본을 불러왔습니다.");}}
 try{await editor.load(current,current.boxes);renderAnswers();$("draft-status").textContent=practice?"연습 · 점수 미반영":"서버 저장본을 불러옴";$("submit").disabled=false;$("skip").disabled=false;if(restored)changed(current.boxes);}catch(e){notice(e.message);$("draft-status").textContent="영상 읽기 실패 · 나갔다가 다시 이어하기";}
}
async function submit(){
 if(submitting||!editor.ready)return;submitting=true;editor.cancel();editor.locked=true;$("submit").disabled=true;$("skip").disabled=true;notice("");
 try{
 await saving;if(saveError){changed(editor.boxes);await saving;if(saveError)throw saveError;}
 if(practice){round.items[0].boxes=structuredClone(editor.boxes);round.items[0].submitted=true;const grade=G.grade(editor.boxes,practiceReference,current);round.state="complete";round.result={...G.summary([{scored:true,grade}]),details:[{id:"practice",position:0,scored:true,grade,reference:practiceReference,explanation:"합성 도형의 어두운 네모 두 곳을 충치 박스 도구로 표시하는 조작 연습입니다. 실제 영상·임상 정답이 아닙니다."}]};}
 else{const old=current;round=await api("rounds/"+round.id+"/cases/"+current.id+"/submit",{boxes:editor.boxes,revision:current.revision,coordinate_system:G.coordinateSystem});localStorage.removeItem("pano-game:"+me.id+":"+round.id+":"+old.id);dirty=false;}
 await showNext();
 }catch(e){notice(e.message);}finally{submitting=false;editor.locked=false;$("submit").disabled=!editor.ready;$("skip").disabled=!editor.ready;}
}
function renderReference(item,detail,host){
 const img=new Image();img.alt="본인 답(노랑)과 기준 답(초록) 비교";img.onload=()=>{
 const c=document.createElement("canvas");c.width=item.width;c.height=item.height;const x=c.getContext("2d");x.drawImage(img,0,0);
 function draw(boxes,color){x.strokeStyle=color;x.lineWidth=Math.max(2,item.width/600);for(const b of boxes){const a=b.bbox;x.strokeRect(a[0],a[1],a[2]-a[0],a[3]-a[1]);}}
 draw(detail.reference||[],"#79ef8e");draw(item.boxes,"#ffc45e");const out=new Image();out.alt=img.alt;out.src=c.toDataURL("image/png");host.append(out);
 };img.onerror=()=>{host.append(document.createTextNode("비교 영상을 불러오지 못했습니다."));};img.src=item.image_url;
}
async function showResults(){
 panel("results-panel");const r=round.result;$("total-points").textContent=r.points;$("average-points").textContent=r.average===null?"—":r.average.toFixed(2);$("result-scored").textContent=r.scored_count+" / "+round.total_target;
 $("result-note").textContent=practice?"조작 연습 결과입니다. 개인·팀 기록에 반영되지 않습니다.":r.points+"점 ÷ "+r.scored_count+"장 = 평균 "+r.average.toFixed(2)+"점. "+r.unscored_count+"장은 채점 제외이며, 0점으로 계산하지 않았습니다.";
 $("result-list").replaceChildren();
 for(const d of r.details){const im=round.items.find(x=>x.id===d.id),row=document.createElement("details");row.className="result-item";const title=document.createElement("summary");
 title.textContent="영상 "+(d.position+1)+" · "+(d.scored?d.grade.points+"점 · 놓친 병소 "+d.grade.fn+" · 기준과 불일치한 박스 "+d.grade.fp:"채점 제외 · 새 판독 답변 저장됨");row.append(title);
 const text=document.createElement("p");text.textContent=d.scored?(d.explanation||"병소 종류와 박스 위치를 기준으로 1:1 비교했습니다. 중복 표시는 추가 점수가 없습니다."):"이 영상은 검증된 정답이 없어 점수를 계산하지 않습니다. 제출한 답은 검수 후 학습 후보로 사용될 수 있습니다.";row.append(text);
 if(d.scored){const legend=document.createElement("p");legend.className="legend";legend.textContent="노랑: 내 답 · 초록: 기준 답 / 박스 IoU 0.30 이상 및 소견 일치. 임상 검증 전의 초기 위치 매칭 규칙입니다.";row.append(legend);let loaded=false;row.addEventListener("toggle",()=>{if(row.open&&!loaded){loaded=true;renderReference(im,d,row);}});}
 $("result-list").append(row);}
 await leaderboard();
}
async function leaderboard(){
 $("ranks").replaceChildren();try{const data=await api("leaderboard?group="+group);if(!data.entries.length){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=6;cell.textContent="아직 완료된 판독 기록이 없습니다. 첫 라운드의 기록을 기다립니다.";row.append(cell);$("ranks").append(row);return;}
 data.entries.forEach((r,i)=>{const row=document.createElement("tr");for(const v of [i+1,r.name+(group!=="country"?" · "+r.country:""),Number(r.average).toFixed(2),r.points,r.scored_count,r.members]){const cell=document.createElement("td");cell.textContent=v;row.append(cell);}$("ranks").append(row);});
 }catch{const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=6;cell.textContent="리더보드를 연결하는 중입니다. 기록이 준비되면 표시됩니다.";row.append(cell);$("ranks").append(row);}}
const practiceReference=[{id:"target-a",category:"caries_ungraded",geometry:"lesion_box",bbox:[310,220,370,280]},{id:"target-b",category:"caries_ungraded",geometry:"lesion_box",bbox:[850,430,920,490]}];
async function startPractice(){
 await saving;if(dirty){notice("저장되지 않은 판독 작업이 있습니다. 먼저 판독을 이어서 저장해 주세요.");return;}
 practice=true;dirty=false;saveError=null;saving=Promise.resolve();
 const im={id:"practice",position:0,width:1200,height:650,scope:G.categories,image_url:"practice.svg",attribution:"Pano 조작 연습 · 합성 도형 · 실제 환자 영상 아님",license:"CC0",boxes:[],revision:0,submitted:false};
 round={id:"practice",state:"active",items:[im],total_target:1,scored_target:1};await showNext();notice("회색 바탕의 어두운 네모 2개를 ‘충치’ 박스로 둘러싸 보세요. 실제 영상이나 병소 정답이 아닌 조작 연습입니다.");
}
$("practice").onclick=()=>startPractice().catch(e=>notice(e.message));$("start").onclick=begin;$("another").onclick=()=>{panel("landing");begin();};
$("account").onclick=fillProfile;
$("profile-form").onsubmit=async e=>{e.preventDefault();try{const p=G.profile({nickname:$("nickname").value,country:$("country").value,university:$("university").value});if(!$("terms").checked)throw Error("참여 조건을 확인해 주세요.");const result=await api("profile",{...p,consent_version:config.terms_version});me=result.user;await refreshMe();panel("landing");notice("프로필을 저장했습니다.");}catch(err){notice(err.message);}};
$("logout").onclick=async()=>{try{await api("logout",{});me=null;await refreshMe();panel("landing");}catch(e){notice(e.message);}};
$("delete-account").onclick=async()=>{if(!confirm("계정, 서버에 저장된 모든 판독 답과 점수를 삭제합니다. 이 사이트에서 복구할 수 없습니다. 삭제할까요?"))return;try{await api("account/delete",{confirm:"DELETE"});me=null;await refreshMe();panel("landing");notice("사이트의 계정과 작업을 삭제했습니다.");}catch(e){notice(e.message);}};
$("finding").onchange=e=>{editor.category=e.target.value;editor.setMode("draw");};$("draw-tool").onclick=()=>editor.setMode("draw");$("select-tool").onclick=()=>editor.setMode("select");$("undo").onclick=()=>editor.undo();$("redo").onclick=()=>editor.redo();$("remove-box").onclick=()=>editor.remove();$("hide-boxes").onclick=()=>editor.toggle();$("fit").onclick=()=>editor.fit();
$("submit").onclick=()=>{if(!editor.boxes.length)$("confirm-submit").showModal();else submit();};$("skip").onclick=()=>{if(editor.boxes.length){notice("표시한 박스가 있습니다. ‘답 제출’을 이용하거나 박스를 삭제하세요.");return;}$("confirm-submit").showModal();};
$("cancel-empty").onclick=()=>$("confirm-submit").close();$("confirm-empty").onclick=()=>{$("confirm-submit").close();submit();};
$("exit-game").onclick=async()=>{await saving;if(dirty&&!confirm("서버에 저장되지 않은 작업이 있습니다. 이 기기에 임시 보관한 뒤 나갈까요?"))return;panel("landing");};
function rankNav(){panel("landing");$("ranking-panel").scrollIntoView({behavior:"smooth"});leaderboard();}
$("nav-rank").onclick=rankNav;$("result-rank").onclick=rankNav;
document.querySelectorAll("[data-group]").forEach(b=>b.onclick=()=>{group=b.dataset.group;document.querySelectorAll("[data-group]").forEach(x=>x.classList.toggle("active",x===b));leaderboard();});
window.addEventListener("beforeunload",e=>{if(dirty&&!practice){e.preventDefault();e.returnValue="";}});
(async()=>{
 const dn=new Intl.DisplayNames(["ko"],{type:"region"});G.countryCodes.map(c=>({code:c,name:dn.of(c)})).sort((a,b)=>a.name.localeCompare(b.name,"ko")).forEach(c=>{const o=document.createElement("option");o.value=c.code;o.textContent=c.name+" ("+c.code+")";$("country").append(o);});
 try{config=await api("config");$("scored-count").textContent=config.scored;$("unscored-count").textContent=config.total-config.scored;$("availability").textContent=config.auth_ready?(config.game_ready?"Google 로그인 후 이어서 시작하세요.":"로그인 연결 완료 · 판독 문제를 준비하고 있습니다."):"Google 로그인 연결 준비 중 · 조작 연습은 이용할 수 있습니다.";
 if(!config.auth_ready){$("login-top").href="#";$("login-top").onclick=e=>{e.preventDefault();notice("Google 로그인 연결을 준비하고 있습니다.");};}
 await refreshMe();if(me&&!me.profile_complete)fillProfile();await leaderboard();
 }catch(e){$("availability").textContent="게임 서버 연결 준비 중 · 조작 연습은 이용할 수 있습니다.";notice(e.message);}
 if(new URLSearchParams(location.search).get("login")==="failed")notice("Google 로그인에 실패했거나 요청이 만료되었습니다. 다시 시작해 주세요.");
})();
