"use strict";
(function(root){
 // League points measure scored reading volume; one perfect ten-question set is 10 points.
 const normalized=name=>String(name??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
 const groupKey=(row,group)=>group==='country'?row.country:JSON.stringify([row.country,normalized(row.name)]);
 const institution=name=>Boolean(normalized(name))&&normalized(name)!=='individual';
 const compare=(a,b)=>b.points-a.points||(b.average??-1)-(a.average??-1)||b.questions-a.questions||a.name.localeCompare(b.name,'en')||a.country.localeCompare(b.country,'en');
 function metrics({name,country,university,average,rounds,members,questions,points,rank}){
  questions=Number.isFinite(questions)?questions:rounds*10;
  points=Number.isFinite(points)?points:(average??0)*questions/100;
  average=questions>0&&average!==null?100*points/questions:null;
  return {name,country,university,average,rounds,members,questions,points,...(Number.isSafeInteger(rank)?{rank}:{})};
 }
 function entries(data,group){
  let rows=[...(data.entries||[]),...(data.demo_entries||[])].filter(r=>group!=='university'||institution(r.name)).map(metrics);
  if(group!=="individual"){
   const groups=new Map();
   for(const row of rows){
    const key=groupKey(row,group);
    const existing=groups.get(key);
    if(!existing){groups.set(key,{...row});continue;}
    existing.points+=row.points;existing.questions+=row.questions;
    existing.average=existing.questions>0?100*existing.points/existing.questions:null;
    existing.rounds+=row.rounds;existing.members+=row.members;
   }
   rows=[...groups.values()];
  }
  return rows.sort((a,b)=>group==='individual'&&a.rank&&b.rank?a.rank-b.rank:compare(a,b));
 }
 root.LoDRanking={entries,compare,groupKey};
 if(typeof module!=="undefined"&&module.exports)module.exports=root.LoDRanking;
})(globalThis);
