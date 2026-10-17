// Fictional leaderboard rows have no sessions, answers, payments or training records.
import Game from "../dist/game-core.js";
import {PUBLIC_RANK_LIMIT} from "./public-ranking.mjs";
const error=(status,message)=>{throw Object.assign(new Error(message),{status});};
function nickname(value){
 const text=typeof value==="string"?value.normalize("NFKC").trim().replace(/\s+/g," "):"";
 if([...text].length<2||[...text].length>24||/[<>\p{Cc}\p{Cf}]/u.test(text))error(400,"닉네임 형식을 확인하세요.");
 return text;
}
const nameKey=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
async function unusedNickname(db,value,id){
 const {results}=await db.prepare('SELECT id,nickname FROM game_demo_leaders WHERE id<>?').bind(id).all();
 if(results.some(r=>nameKey(r.nickname)===nameKey(value)))error(409,'이미 사용 중인 닉네임입니다.');
}
export async function isAdmin(db,uid){return !!(db&&uid&&await db.prepare("SELECT user_id FROM game_admins WHERE user_id=?").bind(uid).first());}
export async function list(db,mode){
 const sql=mode==="individual"?
 "SELECT nickname AS name,country,university,average,rounds,1 AS members,average*rounds*10/100.0 AS points,rounds*10 AS questions FROM game_demo_leaders":
 mode==="country"?
 "SELECT country AS name,country,SUM(average*rounds)/SUM(rounds) AS average,SUM(rounds) AS rounds,COUNT(*) AS members,SUM(average*rounds*10/100.0) AS points,SUM(rounds*10) AS questions FROM game_demo_leaders GROUP BY country":
 "SELECT university AS name,country,SUM(average*rounds)/SUM(rounds) AS average,SUM(rounds) AS rounds,COUNT(*) AS members,SUM(average*rounds*10/100.0) AS points,SUM(rounds*10) AS questions FROM game_demo_leaders GROUP BY country,university";
 const limit=mode==='individual'?` LIMIT ${PUBLIC_RANK_LIMIT}`:'';
 const {results}=await db.prepare(sql+` ORDER BY points DESC,average DESC,questions DESC,name ASC${limit}`).all();
 return results.map(r=>({...r,is_demo:true}));
}
export async function manage(db,path,method,readBody){
 if(path==="/api/admin/demos"&&method==="GET")return {entries:(await db.prepare("SELECT * FROM game_demo_leaders ORDER BY average DESC,id").all()).results};
 if(path==="/api/admin/demos"&&method==="POST"){
  const b=await readBody();
  if(!b||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(b.request_id||""))error(400,"demoCreateInvalid");
  const p=Game.profile({...b,nickname:nickname(b.nickname)});
  if(!Number.isFinite(b.average)||b.average<0||b.average>100)error(400,"demoScoreInvalid");
  if(!Number.isSafeInteger(b.rounds)||b.rounds<1||b.rounds>100000)error(400,"demoRoundsInvalid");
  const id="demo-"+b.request_id;
  await unusedNickname(db,p.nickname,id);
  await db.prepare("INSERT INTO game_demo_leaders(id,nickname,country,university,average,rounds) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM game_demo_leaders WHERE lower(nickname)=lower(?) AND id<>?) ON CONFLICT(id) DO NOTHING").bind(id,p.nickname,p.country,p.university,b.average,b.rounds,p.nickname,id).run();
  const entry=await db.prepare("SELECT * FROM game_demo_leaders WHERE id=?").bind(id).first();
  if(!entry||entry.nickname!==p.nickname||entry.country!==p.country||entry.university!==p.university||entry.average!==b.average||entry.rounds!==b.rounds)error(409,"demoCreateConflict");
  return {ok:true,entry};
 }
 if(path==="/api/admin/demos/delete-all"&&method==="POST"){
  const b=await readBody();if(b.confirm!=="DELETE_DEMOS")error(400,"demoDeleteConfirm");
  const result=await db.prepare("DELETE FROM game_demo_leaders").run();return {ok:true,deleted:result.meta.changes};
 }
 const match=path.match(/^\/api\/admin\/demos\/(demo-[0-9a-f-]{1,64})\/(rename|delete)$/);
 if(!match||method!=="POST")error(404,"요청을 찾을 수 없습니다.");
 const b=await readBody();if(!Number.isInteger(b.revision)||b.revision<0)error(400,"demoInvalidRevision");
 let result;
 if(match[2]==="rename"){
  const name=nickname(b.nickname);await unusedNickname(db,name,match[1]);
  result=await db.prepare("UPDATE game_demo_leaders SET nickname=?,revision=revision+1 WHERE id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM game_demo_leaders WHERE lower(nickname)=lower(?) AND id<>?)").bind(name,match[1],b.revision,name,match[1]).run();
 }else result=await db.prepare("DELETE FROM game_demo_leaders WHERE id=? AND revision=?").bind(match[1],b.revision).run();
 if(!result.meta.changes)error(409,"demoConflict");return {ok:true};
}
