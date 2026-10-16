/* One immutable source image + vector boxes: toggling never swaps or resizes X-ray pixels. */
(function(){
 const width=1462,height=765,src="assets/banner-before.png",ns="http://www.w3.org/2000/svg";
 // Original screenshot coordinates registered onto banner-before (approximately +1,+1 px).
 const annotations=[
  [1048,328,12,25,"#ffbf55"],[998,356,7,10,"#ffbf55"],[998,429,6,6,"#ffbf55"],[915,448,11,17,"#ffbf55"],
  [848,453,6,5,"#ffbf55"],[900,459,6,6,"#ffbf55"],[765,469,6,15,"#ffbf55"],[899,477,10,9,"#ffbf55"],
  [396,259,96,118,"#ff757f"],[1039,384,119,137,"#ff757f"],[910,440,92,136,"#ff757f"],
  [1077,118,81,175,"#65d4ff"],[316,201,74,156,"#65d4ff"],
  [1013,231,23,21,"#c397ff"],[1117,496,32,38,"#c397ff"],[1136,481,32,31,"#c397ff"],[971,543,38,47,"#c397ff"]
 ];
 function create(label){
  const stage=document.createElement("div");stage.className="registered-example";
  const image=new Image();image.src=src;image.width=width;image.height=height;image.alt=label;image.decoding="async";
  const overlay=document.createElementNS(ns,"svg");overlay.setAttribute("viewBox",`0 0 ${width} ${height}`);overlay.setAttribute("aria-hidden","true");overlay.classList.add("example-overlay");
  for(const [x,y,w,h,color] of annotations){const r=document.createElementNS(ns,"rect");for(const [k,v] of Object.entries({x,y,width:w,height:h,stroke:color,fill:"none","stroke-width":1.5,"stroke-dasharray":"5 3"}))r.setAttribute(k,v);overlay.append(r);}
  stage.append(image,overlay);return stage;
 }
 window.PanoExample={create,width,height,src};
})();
