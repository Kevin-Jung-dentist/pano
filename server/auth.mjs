import {createRemoteJWKSet,jwtVerify} from "jose";
const encoder=new TextEncoder();
const googleKeys=createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export const now=()=>Math.floor(Date.now()/1000);
export const random=()=>crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
export const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
export function cookie(req,key){return (req.headers.get("Cookie")||"").split(";").map(s=>s.trim()).find(s=>s.startsWith(key+"="))?.slice(key.length+1);}
export function cookieName(env){return new URL(env.APP_ORIGIN).protocol==="https:"?"__Host-pano-session":"pano-session";}
export function setCookie(name,value,seconds,env){return name+"="+value+"; Path=/; HttpOnly; SameSite=Lax; Max-Age="+seconds+(new URL(env.APP_ORIGIN).protocol==="https:"?"; Secure":"");}
export function ready(env){return Boolean(env.DB&&env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.APP_ORIGIN);}
export async function session(req,env){const token=cookie(req,cookieName(env));if(!token||token.length!==64)return null;return env.DB.prepare("SELECT u.* FROM game_users u JOIN game_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?").bind(await digest(token),now()).first();}
export async function start(env){
 const state=random(),browser=random(),verifier=random(),nonce=random();
 await env.DB.prepare("INSERT INTO game_oauth VALUES(?,?,?,?,?)").bind(await digest(state),await digest(browser),verifier,nonce,now()+600).run();
 const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(verifier))))).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
 const u=new URL("https://accounts.google.com/o/oauth2/v2/auth");
 Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:env.APP_ORIGIN+"/api/auth/callback",response_type:"code",scope:"openid",state,nonce,code_challenge:challenge,code_challenge_method:"S256",prompt:"select_account"}).forEach(([k,v])=>u.searchParams.set(k,v));
 return new Response(null,{status:302,headers:{Location:u.toString(),"Set-Cookie":setCookie("pano-oauth",browser,600,env),"Cache-Control":"no-store"}});
}
export async function validateIdentity(token,env,nonce,keys=googleKeys){
 const {payload}=await jwtVerify(token,keys,{issuer:["https://accounts.google.com","accounts.google.com"],audience:env.GOOGLE_CLIENT_ID,algorithms:["RS256"]});
 if(payload.nonce!==nonce||typeof payload.sub!=="string"||!payload.sub||payload.sub.length>255||(payload.azp&&payload.azp!==env.GOOGLE_CLIENT_ID))throw Error("Google 로그인 응답을 확인할 수 없습니다.");
 return payload.sub;
}
export async function callback(req,env){
 const url=new URL(req.url),state=url.searchParams.get("state"),browser=cookie(req,"pano-oauth"),code=url.searchParams.get("code");
 if(!state||state.length!==64||!browser||browser.length!==64||!code)throw Error("Google 로그인을 다시 시작해 주세요.");
 const record=await env.DB.prepare("DELETE FROM game_oauth WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *").bind(await digest(state),await digest(browser),now()).first();
 if(!record)throw Error("로그인 요청이 만료되었습니다.");
 const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:env.APP_ORIGIN+"/api/auth/callback",grant_type:"authorization_code",code_verifier:record.verifier})});
 if(!response.ok)throw Error("Google 로그인 교환에 실패했습니다.");
 const result=await response.json(),sub=await validateIdentity(result.id_token,env,record.nonce);
 const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO game_users(id,google_sub,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(google_sub) DO NOTHING").bind(id,sub,now(),now()).run();
 const user=await env.DB.prepare("SELECT id FROM game_users WHERE google_sub=?").bind(sub).first();
 const token=random();await env.DB.batch([
 env.DB.prepare("INSERT INTO game_sessions VALUES(?,?,?)").bind(await digest(token),user.id,now()+604800),
 env.DB.prepare("DELETE FROM game_oauth WHERE expires_at<?").bind(now()),
 env.DB.prepare("DELETE FROM game_sessions WHERE expires_at<?").bind(now())]);
 const headers=new Headers({Location:env.APP_ORIGIN+"/","Cache-Control":"no-store"});
 headers.append("Set-Cookie",setCookie(cookieName(env),token,604800,env));headers.append("Set-Cookie",setCookie("pano-oauth","",0,env));
 return new Response(null,{status:302,headers});
}
