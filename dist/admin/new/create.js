"use strict";
(()=>{
 const I=LoDI18n,t=I.t,$=id=>document.getElementById(id),form=$("create-demo-form");
 let busy=false,dirty=false,ready=false,requestId=crypto.randomUUID(),pending=null,statusKey="loading";
 function status(key){statusKey=key;$("create-status").textContent=t(key);$("create-status").classList.remove("error");}
 async function api(path,body){const response=await fetch('/api/'+path,{credentials:'same-origin',method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let data;try{data=await response.json();}catch{throw Error(t('badResponse'));}if(!response.ok)throw Object.assign(Error(I.error(data.error)),{status:response.status});return data;}
 function countries(){const old=$("demo-country").value,dn=new Intl.DisplayNames([I.language],{type:"region"});$("demo-country").replaceChildren();
  const option=document.createElement('option');option.value='';option.textContent=t('select');$("demo-country").append(option);
  PanoGame.countryCodes.map(code=>({code,name:dn.of(code)})).sort((a,b)=>a.name.localeCompare(b.name,I.language)).forEach(c=>{const o=document.createElement('option');o.value=c.code;o.textContent=c.name+' ('+c.code+')';$("demo-country").append(o);});$("demo-country").value=old;
 }
 function freeze(value){busy=value;for(const e of form.elements)e.disabled=value;$("create-submit").textContent=t(value?'saving':'createDemo');}
 form.addEventListener('input',()=>{dirty=true;});
 form.onsubmit=async event=>{
  event.preventDefault();if(!ready||busy||!form.reportValidity())return;
  const values={nickname:$("demo-nickname").value,country:$("demo-country").value,university:$("demo-university").value,average:Number($("demo-score").value),rounds:Number($("demo-rounds").value)};
  // After an ambiguous network error retry the identical operation, not a second record.
  if(pending&&JSON.stringify(values)!==JSON.stringify(pending)){status('demoRetryOriginal');return;}
  pending=values;freeze(true);status('saving');
  try{await api('admin/demos',{...pending,request_id:requestId});dirty=false;pending=null;requestId=crypto.randomUUID();form.reset();status('demoCreated');$("created-actions").hidden=false;}
  catch(error){if(error.status&&error.status<500){pending=null;if(error.status===409)requestId=crypto.randomUUID();}statusKey=null;$("create-status").textContent=error.message;$("create-status").classList.add('error');}
  finally{freeze(false);if(pending){for(const e of form.elements)e.disabled=e.id!=='create-submit';$("create-submit").textContent=t('demoRetryCreate');}}
 };
 document.addEventListener('lod-language',()=>{countries();if(statusKey)status(statusKey);});
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 (async()=>{countries();try{const {user}=await api('me');if(!user?.is_admin){status('adminOnly');return;}ready=true;form.hidden=false;status('createDemoHint');}catch(error){statusKey=null;$("create-status").textContent=error.message;}})();
})();
