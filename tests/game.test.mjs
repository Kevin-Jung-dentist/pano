import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPair,SignJWT} from "jose";
import G from "../dist/game-core.js";
import {handle} from "../server/api.mjs";
import {validateIdentity,digest,now} from "../server/auth.mjs";
import {harness,ref} from "./game-harness.mjs";
const im={width:1200,height:650};
const box=(id,bbox,category="caries_ungraded")=>({id,bbox,category,geometry:G.geometry[category]});
async function call(h,path,data,who="alice"){const r=await handle(h.req(path,data,who),h.env);return {status:r.status,body:await r.json()};}
test("one point per unique finding; duplicates and huge image boxes do not add points",()=>{
 const p=[box("p1",[310,220,370,280]),box("p2",[310,220,370,280]),box("whole",[0,0,1200,650])];
 const g=G.grade(p,ref,im);assert.equal(g.points,1);assert.equal(g.fp,2);assert.equal(g.fn,1);
});
test("one-to-one matching finds maximal result instead of order-dependent greedy match",()=>{
 const r=[box("a",[0,0,10,10]),box("b",[8,0,18,10])];
 assert.equal(G.grade([box("p1",[0,0,18,10]),box("p2",[0,0,7,10])],r,im).points,2);
});
test("multiple acceptable labels of the same physical lesion earn only one point",()=>{
 const r=[{...ref[0],finding_id:"same"},{...box("deep",[200,100,400,400],"deep_caries"),finding_id:"same"}];
 assert.equal(G.grade([box("a1",ref[0].bbox),box("d1",[200,100,400,400],"deep_caries")],r,im).points,1);
});
test("wrong category zero; empty reference zero without false bonus",()=>{assert.equal(G.grade([box("p",ref[0].bbox,"impacted_tooth")],ref,im).points,0);assert.equal(G.grade([],[],im).points,0);});
test("six scored images are the denominator; four unscored are not zeros",()=>{const v=G.summary([...Array.from({length:6},()=>({scored:true,grade:{points:2}})),...Array.from({length:4},()=>({scored:false,grade:null}))]);assert.deepEqual(v,{points:12,scored_count:6,unscored_count:4,average:2});});
test("fractional source pixels survive validation at differing zoom levels",()=>{const b=box("p",[10.125,11.875,34.5,75.25]);assert.deepEqual(G.boxes([b],im)[0],b);for(const scale of [.2,1,2.4]){const result=G.toImage(10.125*scale+25,11.875*scale+32,{scale,left:5,top:7,tx:20,ty:25});assert.ok(Math.abs(result[0]-10.125)<1e-10);assert.ok(Math.abs(result[1]-11.875)<1e-10);}});
test("bounds, geometry and profile country are validated",()=>{assert.throws(()=>G.boxes([box("x",[-1,0,5,5])],im));assert.throws(()=>G.boxes([{...ref[0],geometry:"tooth_box"}],im));assert.throws(()=>G.profile({nickname:"hi",country:"XX",university:"Test"}));});
test("OAuth ID tokens require correct audience, issuer and nonce",async()=>{
 const {privateKey,publicKey}=await generateKeyPair("RS256");
 const token=await new SignJWT({nonce:"nonce",sub:"subject"}).setProtectedHeader({alg:"RS256"}).setIssuer("https://accounts.google.com").setAudience("client").setIssuedAt().setExpirationTime("5m").sign(privateKey);
 assert.equal(await validateIdentity(token,{GOOGLE_CLIENT_ID:"client"},"nonce",publicKey),"subject");
 await assert.rejects(validateIdentity(token,{GOOGLE_CLIENT_ID:"wrong"},"nonce",publicKey));
 await assert.rejects(validateIdentity(token,{GOOGLE_CLIENT_ID:"client"},"wrong",publicKey));
});
test("round allocation 6+4; active round idempotent; gold hidden before completion",async()=>{
 const h=await harness(),r=await call(h,"rounds",{});assert.equal(r.status,200);assert.equal(r.body.items.length,10);assert.equal(r.body.scored_target,6);assert.equal(r.body.result,null);
 assert.equal((await call(h,"rounds",{})).body.id,r.body.id);assert.ok(!JSON.stringify(r.body).includes("finding-a"));assert.ok(r.body.items.every(x=>!Object.hasOwn(x,"kind")));
});
test("server controls score; retry cannot score twice; detailed feedback only after whole round",async()=>{
 const h=await harness();let r=(await call(h,"rounds",{})).body;
 const first=r.items[0];const saved=await call(h,"rounds/"+r.id+"/cases/"+first.id+"/draft",{boxes:[box("p",ref[0].bbox)],revision:0});assert.equal(saved.body.revision,1);
 assert.equal((await call(h,"rounds/"+r.id+"/cases/"+first.id+"/draft",{boxes:[],revision:0})).status,409);
 let path="rounds/"+r.id+"/cases/"+first.id+"/submit";r=(await call(h,path,{boxes:[box("p",ref[0].bbox)],revision:1,points:9999})).body;
 assert.equal(r.result,null);assert.equal((await call(h,path,{boxes:[],revision:0})).status,200);
 for(const c of r.items.filter(x=>!x.submitted))r=(await call(h,"rounds/"+r.id+"/cases/"+c.id+"/submit",{boxes:[box("p",ref[0].bbox)],revision:0,points:9999})).body;
 assert.equal(r.state,"complete");assert.equal(r.result.points,6);assert.equal(r.result.average,1);assert.equal(r.result.unscored_count,4);
 assert.equal(r.result.details.filter(x=>x.reference).length,6);
 const ranks=(await call(h,"leaderboard?group=individual")).body.entries;assert.equal(ranks[0].points,6);assert.equal(ranks[0].average,1);
 assert.equal((await call(h,"rounds/"+r.id+"/cases/"+first.id+"/draft",{boxes:[],revision:2})).status,409);
 const next=(await call(h,"rounds",{})).body;assert.ok(next.items.every(c=>!r.items.some(p=>p.id===c.id)));
});
test("cross-user access, image access, foreign origin and anonymous mutation rejected",async()=>{
 const h=await harness(),r=(await call(h,"rounds",{})).body;
 assert.equal((await call(h,"rounds/"+r.id,undefined,"bob")).status,404);
 assert.equal((await handle(h.req("profile",{nickname:"Xx",country:"US",university:"Uu"},"alice","https://evil.invalid"),h.env)).status,403);
 assert.equal((await handle(new Request(h.env.APP_ORIGIN+"/api/rounds",{method:"POST",headers:{Origin:h.env.APP_ORIGIN,"Content-Type":"application/json"},body:"{}"}),h.env)).status,401);
 assert.equal((await handle(h.req("images/"+r.items[0].id+"?round="+r.id,undefined,"bob"),h.env)).status,404);
});
test("Google identity is not exposed; nickname unique; teams fixed after first round",async()=>{
 const h=await harness(),me=(await call(h,"me")).body;assert.ok(!JSON.stringify(me).includes("google"));
 const profile={nickname:"Alice",country:"US",university:"Other",consent_version:"2026-10-16-v1"};
 assert.equal((await call(h,"profile",profile,"bob")).status,409);
 await call(h,"rounds",{});assert.equal((await call(h,"profile",profile)).status,409);
 assert.equal((await call(h,"profile",{...profile,nickname:"Alice New",country:"KR",university:"Test University"})).status,200);
});
test("unscored reference null and malformed answer rejected without mutation",async()=>{
 const h=await harness(),r=(await call(h,"rounds",{})).body,c=r.items[0];
 assert.equal((await call(h,"rounds/"+r.id+"/cases/"+c.id+"/submit",{boxes:[box("p",[-10,0,5,5])],revision:0})).status,400);
 assert.equal((await call(h,"rounds/"+r.id)).body.items[0].submitted,false);
});
test("configurable mix preserves exact round size",async()=>{const h=await harness();h.env.SCORED_PER_ROUND="8";const r=(await call(h,"rounds",{})).body;assert.equal(r.scored_target,8);assert.equal(r.items.length,10);});
test("expired session cannot submit; account deletion removes sessions, scores and work",async()=>{
 const h=await harness();await call(h,"rounds",{});assert.equal((await call(h,"account/delete",{confirm:"DELETE"})).status,200);assert.equal((await call(h,"me")).body.user,null);
 assert.equal((await h.DB.prepare("SELECT COUNT(*) n FROM game_round_cases WHERE user_id=?").bind("alice").first()).n,0);
 await h.DB.prepare("UPDATE game_sessions SET expires_at=? WHERE token_hash=?").bind(now()-1,await digest(h.tokens.bob)).run();assert.equal((await call(h,"rounds",{},"bob")).status,401);
});

test("oversized requests fail before storing any user answer",async()=>{
 const h=await harness(),r=(await call(h,"rounds",{})).body,c=r.items[0];
 const path="rounds/"+r.id+"/cases/"+c.id+"/draft";
 assert.equal((await call(h,path,{boxes:[],revision:0,padding:"x".repeat(70000)})).status,413);
 assert.equal((await call(h,"rounds/"+r.id)).body.items[0].revision,0);
});
