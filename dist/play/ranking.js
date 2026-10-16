"use strict";
(function(root){
 // Display aggregation only: never writes to real scores, users or training records.
 function entries(data,group){
  let rows=[...(data.entries||[]),...(data.demo_entries||[])].map(({name,country,university,average,rounds,members})=>({name,country,university,average,rounds,members}));
  if(group!=="individual"){
   const groups=new Map();
   for(const row of rows){
    const key=group==="country"?row.country:JSON.stringify([row.country,row.name.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en")]);
    const existing=groups.get(key);
    if(!existing){groups.set(key,{...row});continue;}
    const rounds=existing.rounds+row.rounds;
    existing.average=(existing.average*existing.rounds+row.average*row.rounds)/rounds;
    existing.rounds=rounds;existing.members+=row.members;
   }
   rows=[...groups.values()];
  }
  return rows.sort((a,b)=>(b.average??-1)-(a.average??-1)||b.rounds-a.rounds||a.name.localeCompare(b.name,"en"));
 }
 root.LoDRanking={entries};
 if(typeof module!=="undefined"&&module.exports)module.exports={entries};
})(globalThis);
