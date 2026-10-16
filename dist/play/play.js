"use strict";
const G=window.PanoGame,I=window.LoDI18n,t=I.t,$=id=>document.getElementById(id);
let config={scored:3,total:10},me=null,round=null,current=null,practice=false,group="individual",saving=Promise.resolve(),saveError=null,dirty=false,submitting=false,statusKey="loading";
function notice(message){$("notice").textContent=message;$("notice").hidden=!message;}
function status(key){statusKey=key;$("draft-status").textContent=t(key);}
async function api(path,body){const response=await fetch("/api/"+path,{credentials:"same-origin",headers:body?{"Content-Type":"application/json"}:{},method:body?"POST":"GET",body:body?JSON.stringify(body):undefined});let data;try{data=await response.json();}catch{throw Error(t("badResponse"));}if(!response.ok)throw Error(I.error(data.error||t("requestFailed")));return data;}
function panel(id){for(const p of ["landing","profile-panel","game-panel","results-panel"])$(p).hidden=p!==id;$("ranking-panel").hidden=id==="game-panel"||id==="profile-panel";window.scrollTo(0,0);}
function keyFor(c){return "pano-game:"+me?.id+":"+round?.id+":"+c.id;}
function cache(c,boxes,pending){if(practice)return;try{localStorage.setItem(keyFor(c),JSON.stringify({boxes,revision:c.revision,pending}));}catch{notice(t("cacheFull"));}}
function changed(boxes){
 if(!current)return;current.boxes=boxes;renderAnswers();
 if(practice){status("practiceStatus");return;}
 const c=current,rid=round.id,localKey=keyFor(c);cache(c,boxes,true);dirty=true;status("saving");
 saving=saving.catch(()=>{}).then(async()=>{try{const s=await api("rounds/"+rid+"/cases/"+c.id+"/draft",{boxes,revision:c.revision,coordinate_system:G.coordinateSystem});c.revision=s.revision;if(round?.id===rid)saveError=null;if(JSON.stringify(c.boxes)===JSON.stringify(boxes)){try{localStorage.setItem(localKey,JSON.stringify({boxes,revision:c.revision,pending:false}));}catch{}if(round?.id===rid){dirty=false;status("saved");}}}catch(e){if(round?.id===rid){saveError=e;dirty=true;status("saveFailed");notice(e.message);}}});
}
const editor=new PanoBoxEditor($("canvas"),changed,()=>renderAnswers());
function renderAnswers(){
 $("answer-list").replaceChildren();$("answer-count").textContent=editor.boxes.length;
 editor.boxes.forEach((b,i)=>{const btn=document.createElement("button");btn.className="answer-row"+(editor.selected===b.id?" selected":"");btn.textContent=(i+1)+". "+t(b.category);const small=document.createElement("small");small.textContent=b.bbox.map(x=>I.number(x)).join(", ");btn.append(small);btn.onclick=()=>{editor.setMode("select");editor.select(b.id);};$("answer-list").append(btn);});
 $("remove-box").disabled=!editor.selected||submitting;
}
function accountLabels(){$("account").hidden=!me;$("account").textContent=me?.nickname||t("profile");$("login-top").hidden=!!me;$("start").textContent=t(me?"start":"startLogin");}
async function refreshMe(){me=(await api("me")).user;accountLabels();}
function fillProfile(){if(!me)return;panel("profile-panel");$("nickname").value=me.nickname||"";$("country").value=me.country||"";$("university").value=me.university||"";$("terms").checked=me.profile_complete;}
async function begin(){await saving;notice("");$("confirm-start").textContent=t(me?.feedback_plan==="full"?"beginFull":"beginFree");$("before-start").showModal();}
async function launch(){
 $("before-start").close();
 if(!me){if(!config.auth_ready){notice(t("notReady"));return;}location.assign("/api/auth/start");return;}
 if(!me.profile_complete){fillProfile();return;}
 try{$("start").disabled=true;practice=false;round=await api("rounds",{});await showNext();}catch(e){notice(e.message);}finally{$("start").disabled=false;}
}
function gameLabels(){if(!current)return;$("case-title").textContent=t("caseTitle",{n:current.position+1,total:round.total_target});$("round-label").textContent=t(practice?"practiceLabel":"roundLabel");$("draft-status").textContent=t(statusKey);$("hide-boxes").textContent=t(editor.hidden?"show":"hide");if(practice)$("attribution").textContent=t("practiceAttribution")+" · CC0";}
async function showNext(){
 if(round.state==="complete"){await showResults();return;}
 current=round.items.find(x=>!x.submitted);if(!current)throw Error(t("noCurrent"));
 panel("game-panel");gameLabels();$("attribution").textContent=practice?t("practiceAttribution")+" · CC0":current.attribution+" · "+current.license;status("imageLoading");$("submit").disabled=true;$("skip").disabled=true;
 for(const opt of $("finding").options)opt.hidden=!current.scope.includes(opt.value);$("finding").value=current.scope[0];editor.category=current.scope[0];
 let restored=false;
 if(!practice){try{const saved=JSON.parse(localStorage.getItem(keyFor(current))||"null");if(saved?.pending){if(saved.revision===current.revision){current.boxes=G.boxes(saved.boxes,current);restored=true;}else notice(t("conflict"));}}catch{notice(t("cacheInvalid"));}}
 try{await editor.load(current,current.boxes);renderAnswers();status(practice?"practiceStatus":"loaded");$("submit").disabled=false;$("skip").disabled=false;if(restored)changed(current.boxes);}catch(e){notice(I.error(e.message));status("imageFailed");}
}
async function submit(){
 if(submitting||!editor.ready)return;submitting=true;editor.cancel();editor.locked=true;$("submit").disabled=true;$("skip").disabled=true;notice("");
 try{
 await saving;if(saveError){changed(editor.boxes);await saving;if(saveError)throw saveError;}
 if(practice){round.items[0].boxes=structuredClone(editor.boxes);round.items[0].submitted=true;const grade=G.grade(editor.boxes,practiceReference,current);round.state="complete";round.result={...G.summary([{scored:true,grade}]),details:[{id:"practice",position:0,scored:true,grade,reference:practiceReference}]};}
 else{const old=current;round=await api("rounds/"+round.id+"/cases/"+current.id+"/submit",{boxes:editor.boxes,revision:current.revision,coordinate_system:G.coordinateSystem});try{localStorage.removeItem("pano-game:"+me.id+":"+round.id+":"+old.id);}catch{}dirty=false;}
 await showNext();
 }catch(e){notice(I.error(e.message));}finally{submitting=false;editor.locked=false;$("submit").disabled=!editor.ready;$("skip").disabled=!editor.ready;}
}
function renderReference(item,detail,host){
 const img=new Image();img.alt=t("compareAlt");img.onload=()=>{
 const c=document.createElement("canvas");c.width=item.width;c.height=item.height;const x=c.getContext("2d");x.drawImage(img,0,0);
 function draw(boxes,color){x.strokeStyle=color;x.lineWidth=Math.max(2,item.width/600);for(const b of boxes){const a=b.bbox;x.strokeRect(a[0],a[1],a[2]-a[0],a[3]-a[1]);}}
 draw(detail.reference||[],"#79ef8e");draw(item.boxes,"#ffc45e");const out=new Image();out.alt=t("compareAlt");out.src=c.toDataURL("image/png");host.append(out);
 };img.onerror=()=>host.append(document.createTextNode(t("compareFailed")));img.src=item.image_url;
}
async function showResults(scroll=true){
 if(scroll)panel("results-panel");const r=round.result;$("total-score").textContent=I.number(r.score);$("metric-recall").textContent=I.percent(r.recall);$("metric-iou").textContent=I.percent(r.mean_iou);$("metric-precision").textContent=I.percent(r.precision);$("metric-fp").textContent=r.fp??"—";$("reference-count").textContent=t("referenceCount")+": "+(r.reference_count??"—");
 $("result-note").textContent=r.legacy?t("legacy"):r.score===null?t("noReference"):practice?t("practiceResult"):t(round.feedback_mode==="full"?"fullResultNote":"resultNote",{n:r.reference_count});
 $("practice-result").hidden=true;$("premium-results").hidden=practice||round.feedback_mode==="full";$("result-list").replaceChildren();
 for(const d of r.details){const im=round.items.find(x=>x.id===d.id),row=document.createElement("details");row.className="result-item";const title=document.createElement("summary");
 title.textContent=d.scored?t("caseFeedback",{n:d.position+1,tp:d.grade.tp,fn:d.grade.fn,fp:d.grade.fp}):t("caseLimited",{n:d.position+1});row.append(title);
 const text=document.createElement("p");text.textContent=d.scored?t(practice?"practiceNotice":"defaultExplanation"):t("limitedFeedback");row.append(text);
 if(d.scored){
 const metrics=document.createElement("div");metrics.className="case-metrics";for(const [key,v] of [["recall",d.grade.recall],["overlap",d.grade.mean_iou],["precision",d.grade.precision]]){const span=document.createElement("span");span.textContent=t(key)+": "+I.percent(v);metrics.append(span);}row.append(metrics);
 if(d.explanation){const explanation=document.createElement("p");explanation.textContent=t("sourceExplanation")+": "+d.explanation;row.append(explanation);}
 const legend=document.createElement("p");legend.className="legend";legend.textContent=t("legend");row.append(legend);let loaded=false;row.addEventListener("toggle",()=>{if(row.open&&!loaded){loaded=true;renderReference(im,d,row);}});
 }$("result-list").append(row);}
 await leaderboard();
}
async function leaderboard(){
 $("ranks").replaceChildren();try{const data=await api("leaderboard?group="+group);if(!data.entries.length){rankMessage("emptyRank");return;}
 const countries=new Intl.DisplayNames([I.language],{type:"region"});
 data.entries.forEach((r,i)=>{const row=document.createElement("tr"),name=group==="country"?countries.of(r.country):r.name+" · "+r.country;for(const v of [i+1,name,I.number(r.average),r.rounds,r.tp+" / "+r.reference_count,r.members]){const cell=document.createElement("td");cell.textContent=v;row.append(cell);}$("ranks").append(row);});
 }catch{rankMessage("rankFailed");}
}
function rankMessage(key){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=6;cell.textContent=t(key);row.append(cell);$("ranks").append(row);}
const practiceReference=[{id:"target-a",category:"caries_ungraded",geometry:"lesion_box",bbox:[310,220,370,280]},{id:"target-b",category:"caries_ungraded",geometry:"lesion_box",bbox:[850,430,920,490]}];
async function startPractice(){
 await saving;if(dirty){notice(t("unsaved"));return;}practice=true;dirty=false;saveError=null;saving=Promise.resolve();
 const im={id:"practice",position:0,width:1200,height:650,scope:G.categories,image_url:"practice.svg",attribution:"",license:"CC0",boxes:[],revision:0,submitted:false};
 round={id:"practice",state:"active",items:[im],total_target:1,scored_target:1,feedback_mode:"full"};await showNext();notice(t("practiceNotice"));
}
$("practice").onclick=()=>startPractice().catch(e=>notice(I.error(e.message)));$("start").onclick=begin;$("another").onclick=()=>{panel("landing");begin();};
$("confirm-start").onclick=launch;$("cancel-start").onclick=()=>$("before-start").close();
function premium(){$("before-start").close();$("premium-dialog").showModal();}
$("premium-start").onclick=premium;$("premium-results").onclick=premium;$("close-premium").onclick=()=>$("premium-dialog").close();
$("account").onclick=fillProfile;
$("profile-form").onsubmit=async e=>{e.preventDefault();try{const p=G.profile({nickname:$("nickname").value,country:$("country").value,university:$("university").value});if(!$("terms").checked)throw Error(t("checkTerms"));me=(await api("profile",{...p,consent_version:config.terms_version})).user;await refreshMe();panel("landing");notice(t("profileSaved"));}catch(err){notice(I.error(err.message));}};
$("logout").onclick=async()=>{await saving;try{await api("logout",{});me=null;await refreshMe();panel("landing");}catch(e){notice(e.message);}};
$("delete-account").onclick=async()=>{if(!confirm(t("deleteConfirm")))return;await saving;try{await api("account/delete",{confirm:"DELETE"});me=null;await refreshMe();panel("landing");notice(t("deleted"));}catch(e){notice(e.message);}};
$("finding").onchange=e=>{editor.category=e.target.value;editor.setMode("draw");};$("draw-tool").onclick=()=>editor.setMode("draw");$("select-tool").onclick=()=>editor.setMode("select");$("undo").onclick=()=>editor.undo();$("redo").onclick=()=>editor.redo();$("remove-box").onclick=()=>editor.remove();$("hide-boxes").onclick=()=>editor.toggle();$("fit").onclick=()=>editor.fit();
$("submit").onclick=()=>{if(!editor.boxes.length)$("confirm-submit").showModal();else submit();};$("skip").onclick=()=>{if(editor.boxes.length){notice(t("hasBoxes"));return;}$("confirm-submit").showModal();};
$("cancel-empty").onclick=()=>$("confirm-submit").close();$("confirm-empty").onclick=()=>{$("confirm-submit").close();submit();};
$("exit-game").onclick=async()=>{await saving;if(dirty&&!confirm(t("unsavedExit")))return;panel("landing");notice("");};
function rankNav(){panel("landing");$("ranking-panel").scrollIntoView({behavior:"smooth"});leaderboard();}
$("nav-rank").onclick=rankNav;$("result-rank").onclick=rankNav;
document.querySelectorAll("[data-group]").forEach(b=>b.onclick=()=>{group=b.dataset.group;document.querySelectorAll("[data-group]").forEach(x=>x.classList.toggle("active",x===b));leaderboard();});
window.addEventListener("beforeunload",e=>{if(dirty&&!practice){e.preventDefault();e.returnValue="";}});
function countryOptions(){const old=$("country").value,dn=new Intl.DisplayNames([I.language],{type:"region"});$("country").replaceChildren();const blank=document.createElement("option");blank.value="";blank.textContent=t("select");$("country").append(blank);G.countryCodes.map(c=>({code:c,name:dn.of(c)})).sort((a,b)=>a.name.localeCompare(b.name,I.language)).forEach(c=>{const o=document.createElement("option");o.value=c.code;o.textContent=c.name+" ("+c.code+")";$("country").append(o);});$("country").value=old;}
function availability(){$("availability").textContent=t(config.auth_ready?(config.game_ready?"ready":"bankPending"):"notReady");}
document.addEventListener("lod-language",()=>{countryOptions();accountLabels();availability();gameLabels();renderAnswers();notice("");if(round?.state==="complete"&&!$("results-panel").hidden)showResults(false);else leaderboard();});
(async()=>{countryOptions();availability();try{config=await api("config");availability();if(!config.auth_ready){$("login-top").href="#";$("login-top").onclick=e=>{e.preventDefault();notice(t("notReady"));};}await refreshMe();if(me&&!me.profile_complete)fillProfile();await leaderboard();}catch(e){notice(e.message);}if(new URLSearchParams(location.search).get("login")==="failed")notice(t("loginFailed"));})();
