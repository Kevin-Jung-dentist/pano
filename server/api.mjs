import Game from "../dist/game-core.js";
import * as Auth from "./auth.mjs";
import * as Payments from "./payments.mjs";
import * as Demo from "./demo-leaderboard.mjs";
const TERMS="2026-10-17-v2";
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const parse=s=>s?JSON.parse(s):null;
const key=s=>s.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en");
function targets(env){const n=Number(env.SCORED_PER_ROUND??3);if(!Number.isInteger(n)||n<1||n>10)fail(503,"출제 비율 설정을 확인하세요.");return {scored:n,total:10};}
function pub(u){return u?{id:u.id,nickname:u.nickname,country:u.country,university:u.university,profile_complete:!!u.consent_at,feedback_plan:u.feedback_plan||"free"}:null;}
async function body(req){
 if(Number(req.headers.get("Content-Length"))>65536)fail(413,"요청이 너무 큽니다.");
 const reader=req.body?.getReader(),chunks=[];let size=0;
 if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();fail(413,"요청이 너무 큽니다.");}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,"JSON 형식 오류");}
}
async function user(req,env,complete=true){if(!env.DB)fail(503,"게임 데이터베이스 연결을 준비하고 있습니다.");const u=await Auth.session(req,env);if(!u)fail(401,"Google 로그인이 필요합니다.");if(complete&&!u.consent_at)fail(409,"프로필 설정을 먼저 완료하세요.");return u;}
const query=(db,sql,...args)=>db.prepare(sql).bind(...args);
async function owned(db,rid,uid){const r=await query(db,"SELECT * FROM game_rounds WHERE id=? AND user_id=?",rid,uid).first();if(!r)fail(404,"라운드를 찾을 수 없습니다.");return r;}
async function getRound(db,rid,uid){
 const r=await owned(db,rid,uid);
 const {results}=await query(db,"SELECT rc.*,c.width,c.height,c.scope_json,c.attribution,c.license,c.source FROM game_round_cases rc JOIN game_cases c ON c.id=rc.case_id WHERE rc.round_id=? ORDER BY position",rid).all();
 const items=results.map(c=>({id:c.case_id,position:c.position,width:c.width,height:c.height,scope:parse(c.scope_json),image_url:"/api/images/"+c.case_id+"?round="+rid,attribution:c.attribution,license:c.license,source:c.source,boxes:parse(c.submission_json||c.draft_json),revision:c.revision,submitted:!!c.submitted_at}));
 let result=null;
 if(r.state==="complete"){
 const details=results.map(c=>({id:c.case_id,position:c.position,scored:c.kind==="verified",grade:parse(c.grade_json),reference:c.kind==="verified"?parse(c.reference_json):null,reference_version:c.reference_version,explanation:c.kind==="verified"?c.explanation:null}));
 const current=r.rule_version===Game.version;
 result={score:current?Game.summary(details).score:null,max_score:100,legacy:!current,details:details.map(({grade,...feedback})=>feedback)};
 }
 return {id:r.id,state:r.state,feedback_mode:r.feedback_mode||"free",scored_target:r.scored_target,total_target:r.total_target,rule_version:r.rule_version,country:r.country,university:r.university,items,result};
}
async function startRound(db,u,env){
 if(!env.IMAGES&&!env.IMAGE_SERVICE)fail(503,"영상 저장소를 연결하지 않았습니다.");
 const existing=await query(db,"SELECT id FROM game_rounds WHERE user_id=? AND state='active'",u.id).first();
 if(existing)return getRound(db,existing.id,u.id);
 if(await Payments.openOrder(db,u.id))fail(409,"paymentResolveFirst");
 const paid=await Payments.credit(db,u.id),full=u.feedback_plan==="full"||!!paid;
 const {total}=targets(env),scored=full?total:targets(env).scored;
 const threshold=Number(env.TRAINING_MIN_SCORE??50);if(!Number.isFinite(threshold)||threshold<0||threshold>100)fail(503,"출제 비율 설정을 확인하세요.");
 attempt: for(let retry=0;retry<3;retry++){
 const rows=[],freshIds=[];
 const gold=await query(db,`SELECT c.* FROM game_cases c WHERE c.active=1 AND c.kind='verified' AND NOT EXISTS(SELECT 1 FROM game_round_cases rc WHERE rc.case_id=c.id AND rc.user_id=?) ORDER BY RANDOM() LIMIT ?`,u.id,scored).all();
 if(gold.results.length<scored)fail(409,"아직 풀지 않은 검증 문제와 도전 문제가 충분하지 않습니다. 새 문제를 준비하고 있습니다.");
 rows.push(...gold.results);
 const needed=total-scored;
 if(needed){
 const fresh=await query(db,`SELECT c.* FROM game_cases c WHERE c.active=1 AND c.kind='unscored' AND NOT EXISTS(SELECT 1 FROM game_claims cl WHERE cl.case_id=c.id) AND NOT EXISTS(SELECT 1 FROM game_round_cases rc WHERE rc.case_id=c.id) ORDER BY RANDOM() LIMIT ?`,needed).all();
 freshIds.push(...fresh.results.map(c=>c.id));rows.push(...fresh.results);
 if(fresh.results.length<needed){
 const retry=await query(db,`SELECT c.*,cl.round_id AS previous_round,cl.user_id AS previous_user FROM game_cases c
 JOIN game_claims cl ON cl.case_id=c.id JOIN game_rounds old ON old.id=cl.round_id JOIN game_round_quality q ON q.round_id=old.id
 WHERE c.active=1 AND c.kind='unscored' AND old.state='complete' AND old.rule_version=?
 AND q.rule_version=old.rule_version AND q.eligible=0 AND q.reference_count>0 AND q.score IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM game_round_cases rc WHERE rc.case_id=c.id AND rc.user_id=?)
 AND NOT EXISTS(SELECT 1 FROM game_round_cases done JOIN game_round_quality pass ON pass.round_id=done.round_id WHERE done.case_id=c.id AND pass.eligible=1)
 ORDER BY q.evaluated_at,RANDOM() LIMIT ?`,Game.version,u.id,needed-fresh.results.length).all();
 rows.push(...retry.results);
 }
 }
 if(rows.length<total)fail(409,"아직 풀지 않은 검증 문제와 도전 문제가 충분하지 않습니다. 새 문제를 준비하고 있습니다.");
 if(!rows.some(c=>c.kind==="verified"&&parse(c.reference_json)?.length))fail(409,"채점 세트에 정답 병소가 있는 영상이 필요합니다.");
 // Random order; do not disclose which cases are graded until all ten are submitted.
 for(let i=rows.length-1;i>0;i--){const a=new Uint32Array(1);crypto.getRandomValues(a);const j=a[0]%(i+1);[rows[i],rows[j]]=[rows[j],rows[i]];}
 const rid=crypto.randomUUID();
 const statements=[query(db,"INSERT INTO game_rounds(id,user_id,scored_target,total_target,rule_version,country,university,university_key,created_at,feedback_mode,quality_threshold) VALUES(?,?,?,?,?,?,?,?,?,?,?)",rid,u.id,scored,total,Game.version,u.country,u.university,u.university_key,Auth.now(),full?"full":"free",threshold)];
 if(paid)statements.push(Payments.useCredit(db,paid,u.id,rid));
 for(let i=0;i<rows.length;i++){
 const c=rows[i];
 statements.push(query(db,"INSERT INTO game_round_cases(round_id,case_id,user_id,position,kind,reference_json,reference_version,explanation) VALUES(?,?,?,?,?,?,?,?)",rid,c.id,u.id,i,c.kind,c.reference_json,c.reference_version,c.explanation));
 if(c.kind==="unscored"){
 if(!c.previous_round)statements.push(query(db,"INSERT INTO game_claims VALUES(?,?,?,?)",c.id,0,rid,u.id));
 else{
 // Recheck global fresh-first ordering inside the same atomic batch. A stale claim
 // deliberately violates NOT NULL, rolling back the WHOLE round before retrying.
 const outside=freshIds.length?`AND fresh.id NOT IN (${freshIds.map(()=>"?").join(",")})`:"";
 const noFresh=`NOT EXISTS(SELECT 1 FROM game_cases fresh WHERE fresh.active=1 AND fresh.kind='unscored'
 AND NOT EXISTS(SELECT 1 FROM game_claims cl WHERE cl.case_id=fresh.id)
 AND NOT EXISTS(SELECT 1 FROM game_round_cases rc WHERE rc.case_id=fresh.id) ${outside})`;
 statements.push(query(db,`INSERT INTO game_claims(case_id,slot,round_id,user_id) VALUES(?,0,CASE WHEN ${noFresh} THEN ? ELSE NULL END,?)
 ON CONFLICT(case_id,slot) DO UPDATE SET round_id=CASE WHEN game_claims.round_id=? AND game_claims.user_id=?
 AND EXISTS(SELECT 1 FROM game_round_quality q JOIN game_rounds r ON r.id=q.round_id WHERE q.round_id=game_claims.round_id AND r.state='complete' AND q.eligible=0 AND q.score IS NOT NULL AND r.rule_version=q.rule_version)
 AND NOT EXISTS(SELECT 1 FROM game_round_cases done JOIN game_round_quality pass ON pass.round_id=done.round_id WHERE done.case_id=game_claims.case_id AND pass.eligible=1)
 THEN excluded.round_id ELSE NULL END,user_id=excluded.user_id`,c.id,...freshIds,rid,u.id,c.previous_round,c.previous_user));
 }
 }
 }
 try{await db.batch(statements);return getRound(db,rid,u.id);}catch(e){const active=await query(db,"SELECT id FROM game_rounds WHERE user_id=? AND state='active'",u.id).first();if(active)return getRound(db,active.id,u.id);if(retry===2)throw e;}
 }
}
async function saveCase(req,db,rid,cid,u,submit){
 const r=await owned(db,rid,u.id);const c=await query(db,"SELECT rc.*,c.width,c.height,c.scope_json FROM game_round_cases rc JOIN game_cases c ON c.id=rc.case_id WHERE round_id=? AND case_id=?",rid,cid).first();
 if(!c)fail(404,"배정되지 않은 영상입니다.");
 if(submit&&c.submitted_at)return getRound(db,rid,u.id);
 if(r.state!=="active"||c.submitted_at)fail(409,"이미 제출한 답은 변경할 수 없습니다.");
 const b=await body(req);if(b.coordinate_system&&!Object.keys(Game.coordinateSystem).every(k=>b.coordinate_system[k]===Game.coordinateSystem[k]))fail(400,"좌표계 오류");
 if(!Number.isInteger(b.revision)||b.revision!==c.revision)fail(409,"다른 창에서 변경된 답이 있습니다. 다시 불러오세요.");
 const boxes=Game.boxes(b.boxes,{...c,scope:parse(c.scope_json)});const answer=JSON.stringify(boxes);
 if(submit){
 const grade=c.kind==="verified"?(r.rule_version===Game.version?Game.grade:Game.legacyGrade)(boxes,parse(c.reference_json),{...c,scope:parse(c.scope_json)}):null;
 await db.batch([
 query(db,"UPDATE game_round_cases SET submission_json=?,draft_json=?,submitted_at=?,revision=revision+1,grade_json=?,points=? WHERE round_id=? AND case_id=? AND revision=? AND submitted_at IS NULL",answer,answer,Auth.now(),grade?JSON.stringify(grade):null,grade?.points??null,rid,cid,b.revision),
 query(db,"UPDATE game_rounds SET state='complete',completed_at=? WHERE id=? AND (SELECT COUNT(*) FROM game_round_cases WHERE round_id=? AND submitted_at IS NOT NULL)=total_target",Auth.now(),rid,rid)]);
 const saved=await query(db,"SELECT submission_json FROM game_round_cases WHERE round_id=? AND case_id=?",rid,cid).first();
 if(saved.submission_json!==answer)fail(409,"다른 창에서 먼저 제출했습니다. 다시 불러오세요.");
 return getRound(db,rid,u.id);
 }
 const s=await query(db,"UPDATE game_round_cases SET draft_json=?,revision=revision+1 WHERE round_id=? AND case_id=? AND revision=? AND submitted_at IS NULL RETURNING revision",answer,rid,cid,b.revision).first();
 if(!s)fail(409,"다른 창에서 변경되었습니다.");return s;
}
const roundScores=`WITH round_scores AS (
 SELECT r.id,r.user_id,r.country,r.university,r.university_key,
 SUM(json_extract(rc.grade_json,'$.tp')) tp,SUM(json_extract(rc.grade_json,'$.fp')) fp,
 SUM(json_extract(rc.grade_json,'$.reference_count')) reference_count,
 100.0*SUM(json_extract(rc.grade_json,'$.iou_sum'))/
 (SUM(json_extract(rc.grade_json,'$.reference_count'))+SUM(json_extract(rc.grade_json,'$.fp'))) score
 FROM game_rounds r JOIN game_round_cases rc ON rc.round_id=r.id
 WHERE r.state='complete' AND r.rule_version=? AND rc.kind='verified'
 GROUP BY r.id HAVING SUM(json_extract(rc.grade_json,'$.reference_count'))>0)`;
async function stats(db,uid){return query(db,roundScores+` SELECT AVG(score) average,COUNT(*) rounds FROM round_scores WHERE user_id=?`,Game.version,uid).first();}
async function leaders(db,mode){
 const group=mode==="country"?"r.country":mode==="university"?"r.country,r.university_key":"u.id";
 const name=mode==="country"?"r.country AS name,r.country":mode==="university"?"MIN(r.university) AS name,r.country":"u.nickname AS name,u.country,u.university";
 const {results}=await query(db,roundScores+` SELECT ${name},AVG(r.score) average,COUNT(*) rounds,COUNT(DISTINCT u.id) members FROM round_scores r JOIN game_users u ON u.id=r.user_id WHERE NOT EXISTS(SELECT 1 FROM game_admins admin WHERE admin.user_id=u.id) GROUP BY ${group} ORDER BY average DESC,rounds DESC,name ASC LIMIT 50`,Game.version).all();return results;
}
async function bankReady(env){
 if(!env.DB||(!env.IMAGES&&!env.IMAGE_SERVICE))return false;
 const {scored,total}=targets(env);
 for(const [kind,n] of [["verified",scored],["unscored",total-scored]]){
  const found=await query(env.DB,"SELECT COUNT(*) n FROM (SELECT id FROM game_cases WHERE active=1 AND kind=? LIMIT ?)",kind,n).first();
  if(found.n<n)return false;
 }
 return true;
}
async function history(db,uid){
 const {results}=await query(db,`SELECT r.id,r.state,r.created_at,r.completed_at,r.total_target,
  (SELECT COUNT(*) FROM game_round_cases rc WHERE rc.round_id=r.id AND rc.submitted_at IS NOT NULL) submitted
  FROM game_rounds r WHERE r.user_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 20`,uid).all();
 return results;
}
export async function handle(req,env){
 try{
 const url=new URL(req.url),path=url.pathname;
 if(path==="/api/config")return json({auth_ready:Auth.ready(env),game_ready:await bankReady(env),...targets(env),terms_version:TERMS,rule_version:Game.version,payments_ready:Payments.publicConfig(env).ready,payments:Payments.publicConfig(env)});
 if(!env.APP_ORIGIN)fail(503,"서버 연결을 준비하고 있습니다.");
 if(url.origin!==env.APP_ORIGIN)fail(403,"공식 게임 주소에서 접속하세요.");
 if(path==="/api/payments/paypal/webhook"&&req.method==="POST")return json(await Payments.webhook(req,env));
 if(!["GET","HEAD"].includes(req.method)){
 if(req.headers.get("Origin")!==env.APP_ORIGIN||!req.headers.get("Content-Type")?.startsWith("application/json"))fail(403,"같은 사이트에서 요청해 주세요.");
 }
 if(path==="/api/auth/start"&&req.method==="GET"){if(!Auth.ready(env))fail(503,"Google 로그인 연결을 준비하고 있습니다.");return Auth.start(env);}
 if(path==="/api/auth/callback"&&req.method==="GET"){if(!Auth.ready(env))fail(503,"Google 로그인 연결을 준비하고 있습니다.");try{return await Auth.callback(req,env);}catch{return new Response(null,{status:302,headers:{Location:env.APP_ORIGIN+"/?login=failed","Cache-Control":"no-store"}});}}
 if(path==="/api/me"&&req.method==="GET"){const u=env.DB?await Auth.session(req,env):null;return json({user:u?{...pub(u),is_admin:await Demo.isAdmin(env.DB,u.id)}:null,stats:u?await stats(env.DB,u.id):null,payments:u?await Payments.account(env.DB,u.id):null});}
 if(path==="/api/leaderboard"&&req.method==="GET"){if(!env.DB)return json({entries:[]});const mode=url.searchParams.get("group")||"individual";if(!["individual","country","university"].includes(mode))fail(400,"순위 범위 오류");return json({entries:await leaders(env.DB,mode),demo_entries:await Demo.list(env.DB,mode)});}
 if(/^\/api\/images\/[a-zA-Z0-9_-]+$/.test(path)&&req.method==="GET"&&env.IMAGE_SERVICE)return await env.IMAGE_SERVICE.fetch(req);
 const u=await user(req,env,false),db=env.DB;
 if(path.startsWith("/api/admin/")){
  if(!await Demo.isAdmin(db,u.id))fail(403,"adminOnly");
  return json(await Demo.manage(db,path,req.method,()=>body(req)));
 }
 if(path==="/api/logout"&&req.method==="POST"){await query(db,"DELETE FROM game_sessions WHERE token_hash=?",await Auth.digest(Auth.cookie(req,Auth.cookieName(env)))).run();const res=json({ok:true});res.headers.set("Set-Cookie",Auth.setCookie(Auth.cookieName(env),"",0,env));return res;}
 if(path==="/api/profile"&&req.method==="POST"){
 const b=await body(req),p=Game.profile(b);if(b.consent_version!==TERMS)fail(400,"참여 조건을 확인해 주세요.");
 const started=await query(db,"SELECT id FROM game_rounds WHERE user_id=? LIMIT 1",u.id).first();
 if(started&&(u.country!==p.country||u.university_key!==key(p.university)))fail(409,"라운드 시작 후 국가·대학은 변경할 수 없습니다.");
 try{await query(db,"UPDATE game_users SET nickname=?,nickname_key=?,country=?,university=?,university_key=?,consent_version=?,consent_at=?,updated_at=? WHERE id=?",p.nickname,key(p.nickname),p.country,p.university,key(p.university),TERMS,u.consent_at||Auth.now(),Auth.now(),u.id).run();}catch(e){if(String(e).includes("UNIQUE"))fail(409,"이미 사용 중인 닉네임입니다.");throw e;}
 return json({user:pub(await query(db,"SELECT * FROM game_users WHERE id=?",u.id).first())});
 }
 if(path==="/api/account/delete"&&req.method==="POST"){
 if(await Payments.openOrder(db,u.id)||await Payments.credit(db,u.id))fail(409,"paymentBeforeDelete");
 const b=await body(req);if(b.confirm!=="DELETE")fail(400,"삭제 확인이 필요합니다.");
 await db.batch([
 query(db,"DELETE FROM game_claims WHERE user_id=?",u.id),
 query(db,"DELETE FROM game_round_cases WHERE user_id=?",u.id),
 query(db,"DELETE FROM game_rounds WHERE user_id=?",u.id),
 query(db,"DELETE FROM game_sessions WHERE user_id=?",u.id),
 query(db,"DELETE FROM game_users WHERE id=?",u.id)]);
 const res=json({ok:true});res.headers.set("Set-Cookie",Auth.setCookie(Auth.cookieName(env),"",0,env));return res;
 }
 if(!u.consent_at)fail(409,"프로필 설정을 먼저 완료하세요.");
 if(path==="/api/payments/paypal/orders"&&req.method==="POST")return json(await Payments.create(env,u,await body(req)));
 const payment=path.match(/^\/api\/payments\/paypal\/orders\/([a-zA-Z0-9-]+)(?:\/(capture|cancel))?$/);
 if(payment){
  if(req.method==="GET"&&!payment[2])return json(await Payments.get(env,payment[1],u.id));
  if(req.method==="POST"&&payment[2]==="capture")return json(await Payments.confirm(env,payment[1],u.id));
  if(req.method==="POST"&&payment[2]==="cancel")return json(await Payments.cancel(env,payment[1],u.id));
 }
 if(path==="/api/rounds"&&req.method==="GET")return json({rounds:await history(db,u.id)});
 if(path==="/api/rounds"&&req.method==="POST")return json(await startRound(db,u,env));
 const rid=path.match(/^\/api\/rounds\/([a-zA-Z0-9-]+)$/);
 if(rid&&req.method==="GET")return json(await getRound(db,rid[1],u.id));
 const action=path.match(/^\/api\/rounds\/([a-zA-Z0-9-]+)\/cases\/([a-zA-Z0-9_-]+)\/(draft|submit)$/);
 if(action&&req.method==="POST")return json(await saveCase(req,db,action[1],action[2],u,action[3]==="submit"));
 const image=path.match(/^\/api\/images\/([a-zA-Z0-9_-]+)$/);
 if(image&&req.method==="GET"){
 if(!env.IMAGES)fail(503,"영상 저장소를 연결하지 않았습니다.");
 const allowed=await query(db,"SELECT c.object_key FROM game_cases c JOIN game_round_cases rc ON rc.case_id=c.id JOIN game_rounds r ON r.id=rc.round_id WHERE c.id=? AND r.id=? AND r.user_id=?",image[1],url.searchParams.get("round"),u.id).first();
 if(!allowed)fail(404,"배정되지 않은 영상입니다.");
 const object=await env.IMAGES.get(allowed.object_key);if(!object)fail(404,"영상을 찾을 수 없습니다.");
 return new Response(object.body,{headers:{"Content-Type":"image/png","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }
 fail(404,"요청을 찾을 수 없습니다.");
 }catch(e){if(e.status)return json({error:e.message},e.status);if(/형식|박스|좌표|병소|국가|입력|닉네임|대학/.test(e.message))return json({error:e.message},400);console.error("Pano API request failed",e.name);return json({error:"저장 또는 서버 처리에 실패했습니다. 작업을 유지하고 다시 시도하세요."},500);}
}
