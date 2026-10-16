"use strict";
(() => {
 const before=document.getElementById("demo-before"),after=document.getElementById("demo-after");
 const example=PanoExample.create(LoDI18n.t("afterAlt"));document.getElementById("example-stage").append(example);
 const overlay=example.querySelector("svg"),image=example.querySelector("img");
 function showExample(mode){const isAfter=mode==="after";overlay.hidden=!isAfter;overlay.style.display=isAfter?"":"none";before.setAttribute("aria-pressed",String(!isAfter));after.setAttribute("aria-pressed",String(isAfter));const status=document.getElementById("demo-status-label");status.dataset.i18n=mode;status.textContent=LoDI18n.t(mode);image.alt=LoDI18n.t(isAfter?"afterAlt":"beforeAlt");}
 before.addEventListener("click",()=>showExample("before"));after.addEventListener("click",()=>showExample("after"));
 document.querySelectorAll("[data-practice]").forEach(button=>button.addEventListener("click",()=>document.getElementById("practice").click()));
 document.addEventListener("lod-language",()=>showExample(after.getAttribute("aria-pressed")==="true"?"after":"before"));
 showExample("after");
})();
