// Private question-bank preparation/upload. Never put the manifest or images in dist.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import Game from "../dist/game-core.js";
const root=path.resolve("F:/pano");
function inside(value){const p=path.resolve(value),rel=path.relative(root,p);if(rel.startsWith("..")||path.isAbsolute(rel))throw Error("All files must remain inside F:/pano");return p;}
const sqlString=x=>x===null||x===undefined?"NULL":"'"+String(x).replaceAll("'","''")+"'";
export function compileBank(manifest){
 if(manifest.schema!=="lod-question-bank-v1"||!Array.isArray(manifest.cases))throw Error("Invalid manifest");
 const ids=new Set(),groups=new Set(),objects=new Set(),counts={verified:0,unscored:0};
 const statements=manifest.cases.map(c=>{
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(c.id)||ids.has(c.id)||groups.has(c.group_id)||objects.has(c.object_key))throw Error("Duplicate or invalid case/group");
 ids.add(c.id);groups.add(c.group_id);objects.add(c.object_key);
 if(c.source!=="hanoi"||c.split!=="train"||c.object_key!=="lod/hanoi/"+c.id+".png"||!Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<1||c.height<1||c.width>20000||c.height>20000)throw Error("Unexpected source, split or image coordinates");
 if(!Array.isArray(c.scope)||c.scope.length!==4||new Set(c.scope).size!==4||c.scope.some(x=>!Game.categories.includes(x)))throw Error("Incomplete reference scope");
 if(c.kind==="verified"){Game.boxes(c.reference,c);if(!c.reference_version||c.quality_reviewed_by!=="owner")throw Error("Missing human review");
 const findingIds=new Set();for(const b of c.reference){if(!b.finding_id||typeof b.finding_id!=="string")throw Error("Missing finding id");findingIds.add(b.finding_id);}}
 else if(c.kind!=="unscored"||c.reference!==null)throw Error("Unreviewed image must not carry reference labels");
 if(!c.attribution||!c.license)throw Error("Missing source information");counts[c.kind]++;
 const values=[c.id,c.group_id,c.object_key,c.width,c.height,JSON.stringify(c.scope),c.reference===null?null:JSON.stringify(c.reference),c.reference_version,c.explanation,c.attribution,c.license,c.source,c.kind,1,c.quality_reviewed_by,c.created_at];
 return "INSERT INTO game_cases(id,group_id,object_key,width,height,scope_json,reference_json,reference_version,explanation,attribution,license,source,kind,active,quality_reviewed_by,created_at) VALUES("+values.map(sqlString).join(",")+") ON CONFLICT(id) DO NOTHING;";
 });
 if(counts.verified<3||counts.unscored<7)throw Error("Need at least three verified and seven unreviewed cases");
 return {sql:statements.join("\n")+"\n",counts};
}
function command(args){const wrangler=fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js",import.meta.url));const r=spawnSync(process.execPath,[wrangler,...args],{encoding:"utf8",maxBuffer:128*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:"false",LOCALAPPDATA:path.join(root,"cache/node-local"),APPDATA:path.join(root,"config/node"),TEMP:path.join(root,"tmp"),TMP:path.join(root,"tmp")}});if(r.status!==0)throw Error("Cloudflare command failed. Check login/bindings. "+r.stderr.slice(-1000));return r.stdout;}
function main(){
 const [action,input,...args]=process.argv.slice(2);
 if(action==="prepare"||action==="publish"){
 const manifestPath=inside(input),manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8")),built=compileBank(manifest),dir=path.dirname(manifestPath),sqlPath=inside(path.join(dir,"bank.sql"));
 let bytes=0;for(const c of manifest.cases){const filename=inside(c.local_image),fd=fs.openSync(filename,"r"),header=Buffer.alloc(24);try{fs.readSync(fd,header,0,24,0);}finally{fs.closeSync(fd);}if(!header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||header.readUInt32BE(16)!==c.width||header.readUInt32BE(20)!==c.height)throw Error("PNG original dimensions mismatch");bytes+=fs.statSync(filename).size;}
 fs.writeFileSync(sqlPath,built.sql);console.log(JSON.stringify({counts:built.counts,bytes,sql:sqlPath,published:false}));
 if(action==="prepare")return;
 const database=args[0],bucket=args[1];if(!/^[a-z0-9-]+$/.test(database||"")||!/^[a-z0-9-]+$/.test(bucket||""))throw Error("Provide database and private bucket names");
 const statePath=inside(path.join(dir,"upload-state.json")),digest=crypto.createHash("sha256").update(JSON.stringify(manifest.cases)).digest("hex");
 const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,"utf8")):{digest,uploaded:[]};if(state.digest!==digest)throw Error("Manifest changed; review the old upload state before restarting");
 const uploaded=new Set(state.uploaded);
 for(const c of manifest.cases){if(uploaded.has(c.object_key))continue;command(["r2","object","put",bucket+"/"+c.object_key,"--file",inside(c.local_image),"--content-type","image/png","--remote"]);uploaded.add(c.object_key);const tmp=statePath+".tmp";fs.writeFileSync(tmp,JSON.stringify({digest,uploaded:[...uploaded]}));fs.renameSync(tmp,statePath);console.log("Images uploaded: "+uploaded.size+"/"+manifest.cases.length);}
 command(["d1","execute",database,"--env","production","--remote","--file",sqlPath]);console.log("Question bank published. Existing IDs were preserved; changed references need a reviewed version update.");
 }else if(action==="export-candidates"){
 const db=input,out=inside(args[0]||path.join(root,"league/returns/candidates.json"));if(!/^[a-z0-9-]+$/.test(db||""))throw Error("Database name required");
 const rows=[];let cursor=null;
 for(;;){
 const where=cursor?`WHERE (submitted_at,round_id,case_id)>(${Number(cursor.submitted_at)},${sqlString(cursor.round_id)},${sqlString(cursor.case_id)})`:"";
 const result=JSON.parse(command(["d1","execute",db,"--env","production","--remote","--command",`SELECT * FROM game_training_candidates ${where} ORDER BY submitted_at,round_id,case_id LIMIT 500`,"--json"]));
 const page=result.flatMap(x=>x.results||[]);
 for(const r of page){const boxes=Game.boxes(JSON.parse(r.boxes_json),{width:r.width,height:r.height,scope:JSON.parse(r.scope_json)});if(r.validation_score<r.quality_threshold)throw Error("Quality gate failed");rows.push({...r,boxes,boxes_json:undefined,coordinate_system:Game.coordinateSystem,review_state:"candidate_needs_review",training_ready:false});}
 if(page.length<500)break;cursor=page.at(-1);
 }

 fs.mkdirSync(path.dirname(out),{recursive:true});const tmp=out+".tmp";fs.writeFileSync(tmp,JSON.stringify({schema:"lod-training-candidates-v1",created_at:new Date().toISOString(),candidates:rows},null,2));fs.renameSync(tmp,out);console.log(JSON.stringify({exported:rows.length,path:out}));
 }else throw Error("Usage: node scripts/bank.mjs prepare MANIFEST | publish MANIFEST DATABASE BUCKET | export-candidates DATABASE OUTPUT");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main();}catch(e){console.error(e.message);process.exitCode=1;}
