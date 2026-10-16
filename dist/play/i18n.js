"use strict";
(function(){
const supported=["ko","en","ja"],locales=globalThis.LoDLocales;
let language;try{language=new URLSearchParams(location.search).get("lang")||localStorage.getItem("lod-language");}catch{}
if(!supported.includes(language))language=(navigator.languages||[navigator.language]).map(s=>s.slice(0,2)).find(s=>supported.includes(s))||"en";
function t(key,values={}){let text=locales[language]?.[key]??locales.en[key]??key;return String(text).replace(/\{(\w+)\}/g,(_,k)=>values[k]??"{"+k+"}");}
function apply(){document.documentElement.lang=language;document.title=t("title");const meta=document.querySelector('meta[name="description"]');if(meta)meta.content=t("description");
 document.querySelectorAll("[data-i18n]").forEach(el=>el.textContent=t(el.dataset.i18n));
 document.querySelectorAll("[data-placeholder]").forEach(el=>el.placeholder=t(el.dataset.placeholder));
 document.querySelectorAll("[data-aria]").forEach(el=>el.setAttribute("aria-label",t(el.dataset.aria)));
 const select=document.getElementById("language");if(select){select.value=language;select.setAttribute("aria-label",t("language"));}}
function set(value){if(!supported.includes(value))return;language=value;try{const url=new URL(location.href);url.searchParams.set("lang",value);history.replaceState(null,"",url);localStorage.setItem("lod-language",value);}catch{}apply();document.dispatchEvent(new Event("lod-language"));}
function error(message){if(Object.values(locales[language]).includes(message)||Object.values(locales[language].errors||{}).includes(message))return message;const exact=Object.entries(locales.ko).find(([k,v])=>typeof v==="string"&&v===message);if(exact)return t(exact[0]);return locales[language].errors?.[message]||(language==="ko"?message:t("requestFailed"));}
window.LoDI18n={t,error,set,apply,get language(){return language;},number:(x,d=1)=>x===null||x===undefined?"—":new Intl.NumberFormat(language,{minimumFractionDigits:d,maximumFractionDigits:d}).format(x),percent:x=>x===null||x===undefined?"—":new Intl.NumberFormat(language,{style:"percent",maximumFractionDigits:1}).format(x)};
apply();document.getElementById("language")?.addEventListener("change",e=>set(e.target.value));
})();