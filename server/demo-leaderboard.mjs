// Fictional leaderboard rows have no sessions, answers, payments or training records.
export async function isAdmin(db,uid){return !!(db&&uid&&await db.prepare("SELECT user_id FROM game_admins WHERE user_id=?").bind(uid).first());}
export async function list(db,mode){
 const sql=mode==="individual"?
 "SELECT nickname AS name,country,university,average,rounds,1 AS members FROM game_demo_leaders":
 mode==="country"?
 "SELECT country AS name,country,SUM(average*rounds)/SUM(rounds) AS average,SUM(rounds) AS rounds,COUNT(*) AS members FROM game_demo_leaders GROUP BY country":
 "SELECT university AS name,country,SUM(average*rounds)/SUM(rounds) AS average,SUM(rounds) AS rounds,COUNT(*) AS members FROM game_demo_leaders GROUP BY country,university";
 const {results}=await db.prepare(sql+" ORDER BY average DESC,rounds DESC,name ASC LIMIT 50").all();
 return results.map(r=>({...r,is_demo:true}));
}
export async function manage(db,path,method,readBody){
 const error=(status,message)=>{throw Object.assign(new Error(message),{status});};
 if(path==="/api/admin/demos"&&method==="GET")return {entries:(await db.prepare("SELECT * FROM game_demo_leaders ORDER BY average DESC,id").all()).results};
 if(path==="/api/admin/demos/delete-all"&&method==="POST"){
  const b=await readBody();if(b.confirm!=="DELETE_DEMOS")error(400,"demoDeleteConfirm");
  const result=await db.prepare("DELETE FROM game_demo_leaders").run();return {ok:true,deleted:result.meta.changes};
 }
 const match=path.match(/^\/api\/admin\/demos\/(demo-\d+)\/(rename|delete)$/);
 if(!match||method!=="POST")error(404,"요청을 찾을 수 없습니다.");
 const b=await readBody();if(!Number.isInteger(b.revision)||b.revision<0)error(400,"demoInvalidRevision");
 let result;
 if(match[2]==="rename"){
  const nickname=typeof b.nickname==="string"?b.nickname.normalize("NFKC").trim().replace(/\s+/g," "):"";
  if([...nickname].length<2||[...nickname].length>24||/[<>\p{Cc}\p{Cf}]/u.test(nickname))error(400,"닉네임 형식을 확인하세요.");
  result=await db.prepare("UPDATE game_demo_leaders SET nickname=?,revision=revision+1 WHERE id=? AND revision=?").bind(nickname,match[1],b.revision).run();
 }else result=await db.prepare("DELETE FROM game_demo_leaders WHERE id=? AND revision=?").bind(match[1],b.revision).run();
 if(!result.meta.changes)error(409,"demoConflict");return {ok:true};
}
