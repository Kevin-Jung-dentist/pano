import {DatabaseSync} from "node:sqlite";
import fs from "node:fs";
import * as Auth from "../server/auth.mjs";
export class D1 {
 constructor(){this.db=new DatabaseSync(":memory:");this.db.exec(fs.readFileSync(new URL("../migrations/0001_game.sql",import.meta.url),"utf8"));}
 prepare(sql){const db=this.db;let args=[];const api={bind(...v){args=v;return api;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}};return api;}
 async batch(items){this.db.exec("BEGIN");try{const out=[];for(const item of items)out.push(await item.run());this.db.exec("COMMIT");return out;}catch(e){this.db.exec("ROLLBACK");throw e;}}
}
export const ref=[{id:"a",finding_id:"finding-a",category:"caries_ungraded",geometry:"lesion_box",bbox:[310,220,370,280]},{id:"b",finding_id:"finding-b",category:"caries_ungraded",geometry:"lesion_box",bbox:[850,430,920,490]}];
export async function harness(){
 const DB=new D1(),env={DB,APP_ORIGIN:"http://127.0.0.1:8789",SCORED_PER_ROUND:"6",GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-only",IMAGES:{get:async()=>({body:new Uint8Array([137,80,78,71])})}};
 const tokens={};for(const [id,nickname] of [["alice","Alice"],["bob","Bob"]]){const token=Auth.random();tokens[id]=token;await DB.prepare("INSERT INTO game_users VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,id+"-google",nickname,nickname.toLowerCase(),"KR","Test University","test university","2026-10-16-v1",Auth.now(),Auth.now(),Auth.now()).run();await DB.prepare("INSERT INTO game_sessions VALUES(?,?,?)").bind(await Auth.digest(token),id,Auth.now()+3600).run();}
 for(let i=0;i<30;i++){const kind=i<18?"verified":"unscored";await DB.prepare("INSERT INTO game_cases VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("case"+i,"group"+i,"images/"+i+".png",1200,650,JSON.stringify(["caries_ungraded","deep_caries","periapical_lesion","impacted_tooth"]),kind==="verified"?JSON.stringify(ref):null,kind==="verified"?"v1":null,"Synthetic test reference","Synthetic fixture","CC0","test",kind,1,kind==="verified"?"test-reviewer":null,Auth.now()).run();}
 function req(path,body,who="alice",origin=env.APP_ORIGIN){const headers={Cookie:"pano-session="+tokens[who]};if(body!==undefined){headers.Origin=origin;headers["Content-Type"]="application/json";}return new Request(env.APP_ORIGIN+"/api/"+path,{method:body===undefined?"GET":"POST",headers,body:body===undefined?undefined:JSON.stringify(body)});}
 return {env,DB,tokens,req};
}
