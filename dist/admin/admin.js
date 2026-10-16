"use strict";
(()=>{
 const I=LoDI18n,t=I.t,$=id=>document.getElementById(id);let entries=[],busy=false,loaded=false,statusKey="loading";const drafts=new Map();
 function status(key,error=false){statusKey=key;$("admin-status").textContent=t(key);$("admin-status").classList.toggle("error",error);}
 async function api(path,body){const response=await fetch("/api/"+path,{credentials:"same-origin",method:body===undefined?"GET":"POST",headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(I.error(data.error));return data;}
 function render(){
  $("demo-count").textContent=t("demoCount",{n:entries.length});$("delete-demos").disabled=busy||!entries.length;$("reload-demos").disabled=busy;$("demo-rows").replaceChildren();
  for(const e of entries){const row=document.createElement("tr"),name=document.createElement("td"),input=document.createElement("input"),badge=document.createElement("span");
   input.value=drafts.get(e.id)??e.nickname;input.oninput=()=>{if(input.value===e.nickname)drafts.delete(e.id);else drafts.set(e.id,input.value);};input.maxLength=24;input.minLength=2;input.disabled=busy;input.setAttribute("aria-label",t("nickname")+" · "+e.nickname);badge.textContent=" (demo)";badge.className="demo-tag";name.append(input,badge);row.append(name);
   for(const value of [new Intl.DisplayNames([I.language],{type:"region"}).of(e.country),I.percent(e.average/100)]){const cell=document.createElement("td");cell.textContent=value;row.append(cell);}
   const actions=document.createElement("td");
   for(const [label,action] of [["saveNickname","rename"],["deleteDemo","delete"]]){const button=document.createElement("button");button.textContent=t(label);button.disabled=busy;button.onclick=()=>{if(action==="delete"&&!confirm(t("deleteDemoConfirm",{name:e.nickname})))return;mutate("admin/demos/"+e.id+"/"+action,{nickname:input.value,revision:e.revision});};actions.append(button);}
   input.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();actions.firstChild.click();}};row.append(actions);$("demo-rows").append(row);
  }
 }
 async function reload(){entries=(await api("admin/demos")).entries;loaded=true;render();}
 async function mutate(path,body){if(busy)return;busy=true;document.querySelectorAll("#admin-content input,#admin-content button").forEach(e=>e.disabled=true);status("saving");
  try{await api(path,body);if(path.endsWith('/delete-all'))drafts.clear();else drafts.delete(path.split('/')[2]);await reload();status("adminSaved");}catch(e){statusKey=null;$("admin-status").textContent=e.message;$("admin-status").classList.add("error");}
  finally{busy=false;document.querySelectorAll("#admin-content input,#admin-content button").forEach(e=>e.disabled=false);$("delete-demos").disabled=!entries.length;}
 }
 $("delete-demos").onclick=()=>{if(confirm(t("deleteAllDemosConfirm")))mutate("admin/demos/delete-all",{confirm:"DELETE_DEMOS"});};
 $("reload-demos").onclick=async()=>{try{await reload();status("adminReady");}catch(e){statusKey=null;$("admin-status").textContent=e.message;}};
 document.addEventListener("lod-language",()=>{if(statusKey)status(statusKey);if(loaded)render();});
 window.addEventListener("beforeunload",event=>{if(drafts.size){event.preventDefault();event.returnValue="";}});
 (async()=>{try{const {user}=await api("me");if(!user){status("adminSignIn");$("admin-login").hidden=false;return;}if(!user.is_admin){status("adminOnly",true);return;}await reload();$("admin-content").hidden=false;status("adminReady");}catch(e){statusKey=null;$("admin-status").textContent=e.message;$("admin-status").classList.add("error");}})();
})();
