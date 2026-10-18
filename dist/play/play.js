"use strict";
const G=window.PanoGame,I=window.LoDI18n,t=I.t,$=id=>document.getElementById(id);
let paymentAccount={credits:0,pending:null};
let config={scored:3,total:10},me=null,round=null,current=null,practice=false,group="individual",saving=Promise.resolve(),saveError=null,dirty=false,submitting=false,statusKey="loading";
let readingTimer=null,deadlineClock=null,expiryRunning=false,pendingVisible=false;
function notice(message){$("notice").textContent=message;$("notice").hidden=!message;}
function status(key){statusKey=key;$("draft-status").textContent=t(key);}
async function api(path,body){const response=await fetch("/api/"+path,{signal:AbortSignal.timeout(20000),credentials:"same-origin",headers:body?{"Content-Type":"application/json"}:{},method:body?"POST":"GET",body:body?JSON.stringify(body):undefined});let data;try{data=await response.json();}catch{throw Error(t("badResponse"));}if(!response.ok)throw Error(I.error(data.error||t("requestFailed")));return data;}
function panel(id){if(id!=="game-panel"){stopReadingTimer();pendingVisible=false;}for(const p of ["landing","profile-panel","game-panel","results-panel"])$(p).hidden=p!==id;$("ranking-panel").hidden=id==="game-panel"||id==="profile-panel";window.scrollTo(0,0);}
const practiceDraftKey="lod-practice:banner-before-v1";
function keyFor(c){return "pano-game:"+me?.id+":"+round?.id+":"+c.id;}
function cache(c,boxes,pending){if(practice)return;try{localStorage.setItem(keyFor(c),JSON.stringify({boxes,revision:c.revision,pending}));}catch{notice(t("cacheFull"));}}
function changed(boxes){
 if(!current)return;current.boxes=boxes;renderAnswers();
 if(practice){try{localStorage.setItem(practiceDraftKey,JSON.stringify({boxes,coordinate_system:G.coordinateSystem,width:current.width,height:current.height}));status("practiceSaved");}catch{status("saveFailed");notice(t("cacheFull"));}return;}
 const c=current,rid=round.id,localKey=keyFor(c);cache(c,boxes,true);dirty=true;status("saving");
 saving=saving.catch(()=>{}).then(async()=>{try{const s=await api("rounds/"+rid+"/cases/"+c.id+"/draft",{boxes,revision:c.revision,coordinate_system:G.coordinateSystem});c.revision=s.revision;if(round?.id===rid)saveError=null;if(JSON.stringify(c.boxes)===JSON.stringify(boxes)){try{localStorage.setItem(localKey,JSON.stringify({boxes,revision:c.revision,pending:false}));}catch{}if(round?.id===rid){dirty=false;status("saved");}}}catch(e){if(round?.id===rid){saveError=e;dirty=true;status("saveFailed");notice(e.message);}}});
}
const editor=new PanoBoxEditor($("canvas"),changed,()=>renderAnswers());
function renderAnswers(){
 $("answer-list").replaceChildren();$("answer-count").textContent=editor.boxes.length;
 editor.boxes.forEach((b,i)=>{const btn=document.createElement("button");btn.className="answer-row"+(editor.selected===b.id?" selected":"");btn.textContent=(i+1)+". "+t(b.category);const small=document.createElement("small");small.textContent=b.bbox.map(x=>I.number(x)).join(", ");btn.append(small);btn.onclick=()=>{editor.setMode("select");editor.select(b.id);};$("answer-list").append(btn);});
 $("remove-box").disabled=!editor.selected||submitting;
}
function accountLabels(){$("account").hidden=!me;$("account").textContent=me?.nickname||t("profile");$("login-top").hidden=!!me;$("start").textContent=t(me?"start":"startLogin");if(!me)$("my-ranking").hidden=true;}
async function refreshMe(){const data=await api("me");me=data.user;paymentAccount=data.payments||{credits:0,pending:null};accountLabels();payments.render();await loadHistory();}
function fillProfile(){if(!me)return;panel("profile-panel");$("nickname").value=me.nickname||"";$("country").value=me.country||"";$("university").value=me.university||"";$("terms").checked=me.profile_complete;}
async function loadHistory(){
 $("history-panel").hidden=true;$("history-list").replaceChildren();if(!me?.profile_complete)return;
 try{const data=await api("rounds");$("history-panel").hidden=!data.rounds.length;
 for(const item of data.rounds){const row=document.createElement("button");row.className="history-row";
 const date=new Date(item.created_at*1000).toLocaleString(I.language);
 row.textContent=date+" · "+t(item.state==="complete"?"historyResult":"historyResume",{n:item.submitted,total:item.total_target});
 row.onclick=async()=>{await saving;if(dirty){notice(t("unsaved"));return;}row.disabled=true;try{notice("");practice=false;saveError=null;round=await api("rounds/"+item.id);await showNext();}catch(e){notice(e.message);}finally{row.disabled=false;}};
 $("history-list").append(row);}
 }catch{notice(t("historyFailed"));}
}
async function begin(){await saving;if(dirty){notice(t("unsaved"));return;}notice("");try{await refreshMe();}catch(e){notice(e.message);return;}payments.render();$("confirm-start").textContent=t(me?.feedback_plan==="full"||paymentAccount.credits>0?"beginFull":"beginFree");$("before-start").showModal();}
async function launch(){
 $("before-start").close();
 if(!me){if(!config.auth_ready){notice(t("notReady"));return;}location.assign("/api/auth/start");return;}
 if(!me.profile_complete){fillProfile();return;}
 try{$("start").disabled=true;practice=false;round=await api("rounds",{});await refreshMe();await showNext();}catch(e){notice(e.message);}finally{$("start").disabled=false;}
}
function gameLabels(){if(!current)return;$("case-title").textContent=t("caseTitle",{n:current.position+1,total:round.total_target});$("round-label").textContent=t(practice?"practiceLabel":"roundLabel");$("draft-status").textContent=t(statusKey);$("hide-boxes").textContent=t(editor.hidden?"show":"hide");$("focus-instruction").hidden=round.rule_version!==G.version&&!practice;$("ai-context").hidden=!current.ai_context;$("ai-context-count").textContent=t('aiContextCount',{n:current.ai_context?.boxes?.length||0});$("toggle-ai").textContent=t(editor.aiHidden?'showAi':'hideAi');if(practice)$("attribution").textContent=t("practiceAttribution");}
function stopReadingTimer(){clearInterval(readingTimer);readingTimer=null;deadlineClock=null;$("reading-time").hidden=true;}
function startReadingTimer(){
 stopReadingTimer();if(practice||!current.deadline_at)return;
 const iid=current.id,rid=round.id;deadlineClock=performance.now()+Math.max(0,current.deadline_at-round.server_now)*1000;$("reading-time").hidden=false;
 const tick=()=>{const seconds=Math.max(0,Math.ceil((deadlineClock-performance.now())/1000));$("reading-time").textContent=t('readingTime',{time:Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')});$("reading-time").classList.toggle('time-low',seconds<=20);
 if(seconds===0&&!expiryRunning&&!submitting&&current?.id===iid&&round?.id===rid){expiryRunning=true;submit(true).finally(()=>{expiryRunning=false;});}};
 readingTimer=setInterval(tick,500);tick();
}
async function showNext(){
 stopReadingTimer();
 if(round.state==="complete"){await showResults();return;}
 if(document.hidden&&!practice){pendingVisible=true;editor.ready=false;return;}pendingVisible=false;
 current=round.items.find(x=>!x.submitted);if(!current)throw Error(t("noCurrent"));
 panel("game-panel");gameLabels();$("attribution").textContent=practice?t("practiceAttribution"):current.attribution+" · "+current.license;status("imageLoading");$("submit").disabled=true;$("skip").disabled=true;
 if(!practice&&round.case_seconds){const id=current.id;round=await api('rounds/'+round.id+'/cases/'+id+'/begin',{});current=round.items.find(x=>x.id===id);if(current.submitted){await showNext();return;}startReadingTimer();}
 $("finding").replaceChildren(...current.scope.map(category=>{const option=document.createElement('option');option.value=category;option.dataset.i18n=category;option.textContent=t(category);return option;}));$("finding").value=current.scope[0];editor.category=current.scope[0];
 let restored=false;
 if(!practice){try{const saved=JSON.parse(localStorage.getItem(keyFor(current))||"null");if(saved?.pending){if(saved.revision===current.revision){current.boxes=G.boxes(saved.boxes,current);restored=true;}else notice(t("conflict"));}}catch{notice(t("cacheInvalid"));}}
 try{const id=current.id;await editor.load(current,current.boxes);if(current.id!==id)return;editor.setMode("draw");gameLabels();renderAnswers();status(practice?"practiceStatus":"loaded");$("submit").disabled=deadlineClock!==null&&deadlineClock<=performance.now();$("skip").disabled=$("submit").disabled;if(restored&&!$("submit").disabled)changed(current.boxes);}catch(e){notice(I.error(e.message));status("imageFailed");}
}
async function submit(expired=false){
 if(submitting||(!editor.ready&&!expired))return;submitting=true;if($("confirm-submit").open)$("confirm-submit").close();editor.cancel();editor.locked=true;$("submit").disabled=true;$("skip").disabled=true;notice("");
 try{
 await saving;if(saveError&&!expired){changed(editor.boxes);await saving;if(saveError)throw saveError;}
 if(practice){round.items[0].boxes=structuredClone(editor.boxes);round.items[0].submitted=true;round.state="complete";round.result={practice:true,score:null};try{localStorage.removeItem(practiceDraftKey);}catch{}}
 else{const old=current;round=await api("rounds/"+round.id+"/cases/"+current.id+"/submit",{boxes:editor.boxes,revision:current.revision,coordinate_system:G.coordinateSystem});try{localStorage.removeItem("pano-game:"+me.id+":"+round.id+":"+old.id);}catch{}dirty=false;saveError=null;if(round.items.find(x=>x.id===old.id)?.auto_submitted)notice(t('timeSubmitted'));}
 await showNext();
 }catch(e){notice(expired?t('timeSyncFailed'):I.error(e.message));if(expired)await new Promise(resolve=>setTimeout(resolve,5000));}finally{submitting=false;editor.locked=deadlineClock!==null&&deadlineClock<=performance.now();$("submit").disabled=!editor.ready||editor.locked;$("skip").disabled=!editor.ready||editor.locked;}
}
function renderReference(item,detail,host){
 const alt=t(detail.practice?"practiceOwnAlt":"compareAlt");const img=new Image();img.alt=alt;img.onload=()=>{
 const c=document.createElement("canvas");c.width=item.width;c.height=item.height;const x=c.getContext("2d");x.drawImage(img,0,0);
 function draw(boxes,color){x.strokeStyle=color;x.lineWidth=Math.max(2,item.width/600);for(const b of boxes){const a=b.bbox;x.strokeRect(a[0],a[1],a[2]-a[0],a[3]-a[1]);}}
 draw(detail.reference||[],"#79ef8e");draw(item.boxes,"#ffc45e");const out=new Image();out.alt=alt;out.src=c.toDataURL("image/png");host.append(out);
 };img.onerror=()=>host.append(document.createTextNode(t("compareFailed")));img.src=item.image_url;
}
async function showResults(scroll=true){
 if(!practice)await loadHistory();
 if(scroll)panel("results-panel");if(practice){showPracticeResults();await leaderboard();return;}document.querySelector("#results-panel [data-i18n=resultTitle]").textContent=t("resultTitle");document.querySelector(".main-score span").textContent=t("outOf");$("result-rank").hidden=false;$("another").textContent=t("nextSet");const r=round.result;$("total-score").textContent=I.number(r.score);
 $("result-note").textContent=r.legacy?t("legacy"):r.score===null?t("noReference"):practice?t("practiceResult"):t(round.feedback_mode==="full"?"fullResultNote":"resultNote");
 $("practice-result").hidden=true;$("premium-results").hidden=practice||round.feedback_mode==="full";$("result-list").replaceChildren();
 for(const d of r.details){const im=round.items.find(x=>x.id===d.id),row=document.createElement("details");row.className="result-item";const title=document.createElement("summary");
 title.textContent=d.scored?t("caseFeedback",{n:d.position+1}):t("caseLimited",{n:d.position+1});row.append(title);
 const text=document.createElement("p");text.textContent=d.scored?t(practice?"practiceNotice":"defaultExplanation"):t("limitedFeedback");row.append(text);
 if(d.scored){

 if(d.explanation){const explanation=document.createElement("p");explanation.textContent=t("sourceExplanation")+": "+d.explanation;row.append(explanation);}
 const legend=document.createElement("p");legend.className="legend";legend.textContent=t("legend");row.append(legend);let loaded=false;row.addEventListener("toggle",()=>{if(row.open&&!loaded){loaded=true;renderReference(im,d,row);}});
 }$("result-list").append(row);}
 await leaderboard();
}
let rankRequest=0;
function personalRankCard(own){
 const card=$("my-ranking");card.hidden=!me;if(!me)return;
 $("my-rank-name").textContent=own?.nickname||me.nickname||t('profile');
 $("my-rank-position").textContent=own?.rank?t('rankPosition',{n:I.number(own.rank,0)}):'—';
 $("my-rank-points").textContent=own?I.number(own.points,2):'—';
 $("my-rank-questions").textContent=own?I.number(own.questions,0):'—';
 $("my-rank-average").textContent=I.percent(own?.average==null?null:own.average/100);
 $("my-rank-note").textContent=t(!own?'rankMineFailed':own.state==='excluded'?'rankAdminExcluded':own.state==='unranked'?'rankNotYet':'rankMineNote');
}
async function leaderboard(){
 const request=++rankRequest,selected=group;$("ranks").replaceChildren();$("rank-more").hidden=true;
 const identity=selected==='individual'?'nickname':selected;$("rank-identity").dataset.i18n=identity;$("rank-identity").textContent=t(identity);
 const personal=me?api('me/ranking').catch(()=>null):Promise.resolve(null);
 try{const [data,own]=await Promise.all([api("leaderboard?group="+selected),personal]);if(request!==rankRequest)return;
 personalRankCard(own);
 const countries=new Intl.DisplayNames([I.language],{type:"region"});
 const entries=LoDRanking.entries(data,selected);
 let shown=0;
 function appendPage(){
 const end=Math.min(shown+50,entries.length);
 entries.slice(shown,end).forEach((r,offset)=>{
  const i=shown+offset;
  const row=document.createElement("tr");
  const mine=selected==='individual'&&own?.state==='ranked'&&r.rank===own.rank;
  if(mine)row.className='rank-own';
  const name=selected==="country"?countries.of(r.country):r.name;
  for(const [col,v] of [r.rank||i+1,name,I.number(r.points,2),I.number(r.questions,0),I.percent(r.average===null?null:r.average/100)].entries()){
   const cell=document.createElement("td");cell.textContent=v;
   if(col===1&&mine){const badge=document.createElement('span');badge.className='rank-you';badge.textContent=t('rankYou');cell.append(badge);}
   if(col===1&&selected!=="country"){const region=document.createElement("small");region.className="rank-region";region.textContent=countries.of(r.country);cell.append(region);}
   row.append(cell);
  }$("ranks").append(row);
 });
 shown=end;$("rank-more").hidden=shown>=entries.length;
 }
 $("rank-more").onclick=appendPage;appendPage();
 if(!entries.length)rankMessage("emptyRank");
 }catch{const own=await personal;if(request===rankRequest){personalRankCard(own);rankMessage("rankFailed");}}
}
function rankMessage(key){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=5;cell.textContent=t(key);row.append(cell);$("ranks").append(row);}
function showPracticeResults(){
 const item=round.items[0];document.querySelector("#results-panel [data-i18n=resultTitle]").textContent=t("practiceComplete");
 $("total-score").textContent=item.boxes.length;document.querySelector(".main-score span").textContent=t("practiceBoxCount");
 $("result-note").textContent=t("practiceResult");$("practice-result").hidden=true;$("premium-results").hidden=true;$("result-rank").hidden=true;$("another").textContent=t("practiceAgain");
 const grid=document.createElement("div");grid.className="practice-compare";
 for(const key of ["practiceOwnTitle","practiceExampleTitle"]){const section=document.createElement("section"),heading=document.createElement("h3");heading.textContent=t(key);section.append(heading);
 if(key==="practiceOwnTitle")renderReference(item,{practice:true},section);else{section.append(PanoExample.create(t("afterAlt")));}grid.append(section);}
 $("result-list").replaceChildren(grid);
}
async function startPractice(){
 stopReadingTimer();
 await saving;if(dirty){notice(t("unsaved"));return;}practice=true;dirty=false;saveError=null;saving=Promise.resolve();
 const im={id:"practice-banner-before",position:0,width:1462,height:765,scope:G.labelCategories,image_url:"/play/assets/banner-before.png",attribution:t("practiceAttribution"),license:"",boxes:[],revision:0,submitted:false};
 let restored=false;try{const saved=JSON.parse(localStorage.getItem(practiceDraftKey)||"null");if(saved&&saved.width===im.width&&saved.height===im.height&&Object.entries(G.coordinateSystem).every(([k,v])=>saved.coordinate_system?.[k]===v)){im.boxes=G.boxes(saved.boxes,im);restored=im.boxes.length>0;}}catch{notice(t("cacheInvalid"));}
 round={id:"practice",state:"active",items:[im],total_target:1,scored_target:0,feedback_mode:"practice"};await showNext();notice(t(restored?"practiceRestored":"practiceNotice"));
}
$("practice").onclick=()=>startPractice().catch(e=>notice(I.error(e.message)));$("start").onclick=begin;$("another").onclick=()=>{if(practice)startPractice().catch(e=>notice(I.error(e.message)));else{panel("landing");begin();}};
$("confirm-start").onclick=launch;$("cancel-start").onclick=()=>$("before-start").close();
const payments=LoDPayments({api,state:()=>({config,me,paymentAccount}),refresh:refreshMe,profile:fillProfile,launch});
$("account").onclick=fillProfile;
$("profile-form").onsubmit=async e=>{e.preventDefault();try{const p=G.profile({nickname:$("nickname").value,country:$("country").value,university:$("university").value});if(!$("terms").checked)throw Error(t("checkTerms"));me=(await api("profile",{...p,consent_version:config.terms_version})).user;await refreshMe();panel("landing");await leaderboard();notice(t("profileSaved"));}catch(err){notice(I.error(err.message));}};
$("logout").onclick=async()=>{await saving;try{await api("logout",{});me=null;accountLabels();await refreshMe();panel("landing");await leaderboard();}catch(e){notice(e.message);}};
$("delete-account").onclick=async()=>{if(!confirm(t("deleteConfirm")))return;await saving;try{await api("account/delete",{confirm:"DELETE"});me=null;accountLabels();await refreshMe();panel("landing");await leaderboard();notice(t("deleted"));}catch(e){notice(e.message);}};
$("finding").onchange=e=>{editor.category=e.target.value;editor.setMode("draw");};$("draw-tool").onclick=()=>editor.setMode("draw");$("select-tool").onclick=()=>editor.setMode("select");$("pan-tool").onclick=()=>editor.setMode("pan");$("undo").onclick=()=>editor.undo();$("redo").onclick=()=>editor.redo();$("remove-box").onclick=()=>editor.remove();$("hide-boxes").onclick=()=>editor.toggle();$("fit").onclick=()=>editor.fit();
$("toggle-ai").onclick=()=>{editor.aiHidden=!editor.aiHidden;editor.paint();gameLabels();};
$("submit").onclick=()=>{if(!editor.boxes.length)$("confirm-submit").showModal();else submit();};$("skip").onclick=()=>{if(editor.boxes.length){notice(t("hasBoxes"));return;}$("confirm-submit").showModal();};
$("cancel-empty").onclick=()=>$("confirm-submit").close();$("confirm-empty").onclick=()=>{$("confirm-submit").close();submit();};
$("exit-game").onclick=async()=>{await saving;if(dirty){notice(t("unsaved"));return;}stopReadingTimer();panel("landing");await loadHistory();notice(round?.case_seconds?t('timerContinues'):'');};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&pendingVisible){pendingVisible=false;showNext().catch(e=>notice(I.error(e.message)));}});
function rankNav(){panel("landing");$("ranking-panel").scrollIntoView({behavior:"smooth"});leaderboard();}
$("nav-rank").onclick=rankNav;$("result-rank").onclick=rankNav;
document.querySelectorAll("[data-group]").forEach(b=>b.onclick=()=>{group=b.dataset.group;document.querySelectorAll("[data-group]").forEach(x=>x.classList.toggle("active",x===b));leaderboard();});
window.addEventListener("beforeunload",e=>{if(dirty&&!practice){e.preventDefault();e.returnValue="";}});
function countryOptions(){const old=$("country").value,dn=new Intl.DisplayNames([I.language],{type:"region"});$("country").replaceChildren();const blank=document.createElement("option");blank.value="";blank.textContent=t("select");$("country").append(blank);G.countryCodes.map(c=>({code:c,name:dn.of(c)})).sort((a,b)=>a.name.localeCompare(b.name,I.language)).forEach(c=>{const o=document.createElement("option");o.value=c.code;o.textContent=c.name+" ("+c.code+")";$("country").append(o);});$("country").value=old;}
function availability(){$("availability").textContent=t(config.auth_ready?(config.game_ready?"ready":"bankPending"):"notReady");}
document.addEventListener("lod-language",()=>{countryOptions();accountLabels();availability();gameLabels();renderAnswers();notice("");loadHistory();if(round?.state==="complete"&&!$("results-panel").hidden)showResults(false);else leaderboard();});
(async()=>{countryOptions();availability();try{config=await api("config");availability();if(!config.auth_ready){$("login-top").href="#";$("login-top").onclick=e=>{e.preventDefault();notice(t("notReady"));};}await refreshMe();if(me&&!me.profile_complete)fillProfile();await leaderboard();payments.render();await payments.returned();}catch(e){notice(e.message);}if(new URLSearchParams(location.search).get("login")==="failed")notice(t("loginFailed"));})();
