import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPair,SignJWT} from "jose";
import G from "../dist/game-core.js";
import {handle} from "../server/api.mjs";
import {validateIdentity,digest,now} from "../server/auth.mjs";
import {harness,ref,beginReading} from "./game-harness.mjs";
const im={width:1200,height:650};
const box=(id,bbox,category="caries_ungraded")=>({id,bbox,category,geometry:G.geometry[category]});
async function call(h,path,data,who="alice"){await beginReading(h,path,who);const r=await handle(h.req(path,data,who),h.env);return {status:r.status,body:await r.json()};}
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
test("score uses total reference lesions, not per-image means or unscored images",()=>{
 const a=G.grade([box("p",ref[0].bbox)],ref,im),b=G.grade([box("p",ref[0].bbox)],[ref[0]],im);
 const v=G.summary([{scored:true,grade:a},{scored:true,grade:b},{scored:false,grade:null}]);
 assert.equal(v.reference_count,3);assert.equal(v.tp,2);assert.equal(v.score,200/3);assert.equal(v.scored_count,2);assert.equal(v.unscored_count,1);
});

test("fractional source pixels survive validation at differing zoom levels",()=>{const b=box("p",[10.125,11.875,34.5,75.25]);assert.deepEqual(G.boxes([b],im)[0],b);for(const scale of [.2,1,2.4]){const result=G.toImage(10.125*scale+25,11.875*scale+32,{scale,left:5,top:7,tx:20,ty:25});assert.ok(Math.abs(result[0]-10.125)<1e-10);assert.ok(Math.abs(result[1]-11.875)<1e-10);}});
test("bounds, geometry and profile country are validated",()=>{assert.throws(()=>G.boxes([box("x",[-1,0,5,5])],im));assert.throws(()=>G.boxes([{...ref[0],geometry:"tooth_box"}],im));assert.throws(()=>G.profile({nickname:"hi",country:"XX",university:"Test"}));});
test("OAuth ID tokens require correct audience, issuer and nonce",async()=>{
 const {privateKey,publicKey}=await generateKeyPair("RS256");
 const token=await new SignJWT({nonce:"nonce",sub:"subject"}).setProtectedHeader({alg:"RS256"}).setIssuer("https://accounts.google.com").setAudience("client").setIssuedAt().setExpirationTime("5m").sign(privateKey);
 assert.equal(await validateIdentity(token,{GOOGLE_CLIENT_ID:"client"},"nonce",publicKey),"subject");
 await assert.rejects(validateIdentity(token,{GOOGLE_CLIENT_ID:"wrong"},"nonce",publicKey));
 await assert.rejects(validateIdentity(token,{GOOGLE_CLIENT_ID:"client"},"wrong",publicKey));
});
test("round allocation 3+7; active round idempotent; gold hidden before completion",async()=>{
 const h=await harness(),r=await call(h,"rounds",{});assert.equal(r.status,200);assert.equal(r.body.items.length,10);assert.equal(r.body.scored_target,3);assert.equal(r.body.result,null);
 assert.equal((await call(h,"rounds",{})).body.id,r.body.id);assert.ok(!JSON.stringify(r.body).includes("finding-a"));assert.ok(r.body.items.every(x=>!Object.hasOwn(x,"kind")));
});
test("server controls score; retry cannot score twice; detailed feedback only after whole round",async()=>{
 const h=await harness();let r=(await call(h,"rounds",{})).body;
 const first=r.items[0];const saved=await call(h,"rounds/"+r.id+"/cases/"+first.id+"/draft",{boxes:[box("p",ref[0].bbox)],revision:0});assert.equal(saved.body.revision,1);
 assert.equal((await call(h,"rounds/"+r.id+"/cases/"+first.id+"/draft",{boxes:[],revision:0})).status,409);
 let path="rounds/"+r.id+"/cases/"+first.id+"/submit";r=(await call(h,path,{boxes:[box("p",ref[0].bbox)],revision:1,points:9999})).body;
 assert.equal(r.result,null);assert.equal((await call(h,path,{boxes:[],revision:0})).status,200);
 for(const c of r.items.filter(x=>!x.submitted))r=(await call(h,"rounds/"+r.id+"/cases/"+c.id+"/submit",{boxes:[box("p",ref[0].bbox)],revision:0,points:9999})).body;
 assert.equal(r.state,"complete");assert.equal(r.result.score,50);for(const k of ["points","tp","fp","fn","reference_count","scored_count","unscored_count"])assert.ok(!Object.hasOwn(r.result,k));assert.ok(r.result.details.every(x=>!Object.hasOwn(x,"grade")));
 assert.equal(r.result.details.filter(x=>x.reference).length,3);
 const ranks=(await call(h,"leaderboard?group=individual")).body.entries;assert.ok(!Object.hasOwn(ranks[0],"tp"));assert.ok(!Object.hasOwn(ranks[0],"reference_count"));assert.equal(ranks[0].average,50);
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
 const profile={nickname:"Alice",country:"US",university:"Other",consent_version:"2026-10-17-v2"};
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

test("100-point score penalizes missed lesions, imprecise boxes and false positives independently",()=>{
 assert.equal(G.grade(ref,ref,im).score,100);
 assert.equal(G.grade([ref[0]],ref,im).score,50);
 assert.equal(G.grade([box("half",[310,220,340,280])],[ref[0]],im).score,50);
 const fp=G.grade([ref[0],box("wrong",[0,0,10,10])],[ref[0]],im);assert.equal(fp.score,75);assert.equal(fp.precision,.5);assert.equal(fp.recall,1);
 assert.equal(G.grade([],ref,im).score,0);assert.equal(G.grade([],[],im).score,null);
 assert.equal(G.summary([{scored:true,grade:G.grade(ref,ref,im)},{scored:true,grade:G.grade([box("wrong",[0,0,10,10])],[],im)}]).score,87.5);
});
test("one-to-one match maximizes overlap for the maximum number of findings",()=>{
 const r=[box("a",[0,0,20,20]),box("b",[10,0,30,20])],pred=[box("p",[0,0,20,20]),box("q",[10,0,30,20])];
 assert.equal(G.grade(pred,r,im).iou_sum,2);assert.equal(G.grade([...pred].reverse(),r,im).score,100);
 assert.equal(G.grade(pred,[...r].reverse(),im).score,100);
});
test("no overlap in unreviewed assignments across readers",async()=>{
 const h=await harness(),a=(await call(h,"rounds",{})).body,b=(await call(h,"rounds",{},"bob")).body;
 const x=await h.DB.prepare("SELECT case_id,COUNT(*) n FROM game_claims GROUP BY case_id HAVING COUNT(*)>1").all();assert.equal(x.results.length,0);
 assert.equal((await h.DB.prepare("SELECT COUNT(*) n FROM game_claims").first()).n,14);
 assert.equal(a.scored_target,3);assert.equal(b.scored_target,3);
});
async function complete(h,who,pred){let r=(await call(h,"rounds",{},who)).body;for(const c of r.items)r=(await call(h,"rounds/"+r.id+"/cases/"+c.id+"/submit",{boxes:pred,revision:0},who)).body;return r;}
test("50-point quality gate includes only submitted unreviewed answers from completed passing sets",async()=>{
 const h=await harness();const a=await complete(h,"alice",[ref[0]]);assert.equal(a.result.score,50);
 let rows=(await h.DB.prepare("SELECT * FROM game_training_candidates").all()).results;assert.equal(rows.length,7);assert.ok(rows.every(r=>r.user_id==="alice"&&r.quality_threshold===50));
 const b=await complete(h,"bob",[ref[0],box("wrong",[0,0,10,10])]);assert.ok(b.result.score<50);
 rows=(await h.DB.prepare("SELECT * FROM game_training_candidates").all()).results;assert.equal(rows.length,7);
 const audit=(await h.DB.prepare("SELECT eligible FROM game_quality_audit WHERE user_id='bob'").first());assert.equal(audit.eligible,0);
});
test("threshold is frozen per set, future configuration does not retroactively admit failed answers",async()=>{
 const h=await harness();h.env.TRAINING_MIN_SCORE="85";await call(h,"rounds",{});h.env.TRAINING_MIN_SCORE="50";await complete(h,"alice",[ref[0]]);
 assert.equal((await h.DB.prepare("SELECT COUNT(*) n FROM game_training_candidates").first()).n,0);
});
test("full-feedback entitlement affects future sets only; client cannot purchase itself",async()=>{
 const h=await harness();const a=(await call(h,"rounds",{feedback_plan:"full",scored:10})).body;assert.equal(a.scored_target,3);
 await h.DB.prepare("UPDATE game_users SET feedback_plan='full' WHERE id='alice'").run();assert.equal((await call(h,"rounds",{})).body.scored_target,3);
 await complete(h,"alice",ref);const next=(await call(h,"rounds",{})).body;assert.equal(next.scored_target,10);assert.equal(next.feedback_mode,"full");
});
test("legacy scoring records remain readable and are excluded from new rankings and training candidates",async()=>{
 const h=await harness();const r=(await call(h,"rounds",{})).body;await h.DB.prepare("UPDATE game_rounds SET rule_version='pano-game-1' WHERE id=?").bind(r.id).run();const done=await complete(h,"alice",ref);
 assert.equal(done.result.legacy,true);assert.equal(done.result.score,null);assert.equal((await call(h,"leaderboard")).body.entries.length,0);assert.equal((await h.DB.prepare("SELECT COUNT(*) n FROM game_training_candidates").first()).n,0);
});

test("bank import rejects evaluation images, duplicate groups and incomplete ground truth",async()=>{
 const {compileBank}=await import('../scripts/bank.mjs');
 const cases=Array.from({length:10},(_,i)=>({id:'synthetic'+i,group_id:'group'+i,object_key:'lod/hanoi/synthetic'+i+'.png',width:1200,height:650,scope:G.categories,reference:i<3?ref:null,reference_version:i<3?'v1':null,quality_reviewed_by:i<3?'owner':null,kind:i<3?'verified':'unscored',source:'hanoi',split:'train',license:'CC0',attribution:'Synthetic fixture',created_at:1}));
 assert.deepEqual(compileBank({schema:'lod-question-bank-v1',cases}).counts,{verified:3,unscored:7});
 const change=(i,patch)=>cases.map((c,j)=>j===i?{...c,...patch}:c);
 assert.throws(()=>compileBank({schema:'lod-question-bank-v1',cases:change(3,{split:'test'})}));
 assert.throws(()=>compileBank({schema:'lod-question-bank-v1',cases:change(3,{group_id:'group0'})}));
 assert.throws(()=>compileBank({schema:'lod-question-bank-v1',cases:change(0,{quality_reviewed_by:null})}));
 assert.throws(()=>compileBank({schema:'lod-question-bank-v1',cases:change(0,{scope:['caries_ungraded']})}));
});
test('round history survives reload without revealing references or another user history',async()=>{
 const h=await harness();const r=await complete(h,'alice',ref);
 const list=(await call(h,'rounds')).body.rounds;
 assert.equal(list.length,1);assert.equal(list[0].state,'complete');assert.equal(list[0].submitted,10);
 assert.ok(!JSON.stringify(list).includes('reference'));assert.ok(!JSON.stringify(list).includes('finding-a'));
 assert.equal((await call(h,'rounds',undefined,'bob')).body.rounds.length,0);
 assert.equal((await call(h,'rounds/'+r.id)).body.result.score,100);
});

test("13 of 26 exact findings score 50; overlap and false positives lower it",()=>{
 const refs=Array.from({length:26},(_,i)=>box('r'+i,[(i%13)*40,Math.floor(i/13)*100,(i%13)*40+20,Math.floor(i/13)*100+20]));
 const exact=refs.slice(0,13);assert.equal(G.grade(exact,refs,im).score,50);
 const partial=exact.map(b=>({...b,bbox:[b.bbox[0],b.bbox[1],b.bbox[0]+16,b.bbox[3]]}));assert.ok(Math.abs(G.grade(partial,refs,im).score-40)<1e-9);
 assert.ok(Math.abs(G.grade([...exact,box('extra',[1000,500,1010,510])],refs,im).score-100*12.75/26)<1e-9);
});