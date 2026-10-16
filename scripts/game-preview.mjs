// Isolated localhost QA only. Never bundled into Pages Functions.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {harness} from "../tests/game-harness.mjs";
import {handle} from "../server/api.mjs";
import {guardAdminPage,adminAssetResponse} from "../server/admin-page.mjs";
import imageWorker from "../server/image-worker.mjs";
import {compileBank} from "./bank.mjs";
const h=await harness();
if(process.env.PANO_QA_ADMIN==="alice")h.DB.db.prepare("INSERT INTO game_admins VALUES(?,?)").run("alice",Math.floor(Date.now()/1000));
const root=fileURLToPath(new URL("../dist/",import.meta.url));
h.env.IMAGES={get:async()=>({body:fs.readFileSync(new URL("../tests/fixtures/game-practice.png",import.meta.url))})};
const port=Number(process.env.PANO_QA_PORT||8789);h.env.APP_ORIGIN="http://127.0.0.1:"+port;
if(process.env.PANO_QA_BANK){
 const filename=path.resolve(process.env.PANO_QA_BANK);if(!filename.toLowerCase().startsWith("f:\\pano\\"))throw Error("QA bank must remain under F:/pano");
 const manifest=JSON.parse(fs.readFileSync(filename,"utf8"));
 h.DB.db.exec("DELETE FROM game_cases;");h.DB.db.exec(compileBank(manifest).sql);
 const images=new Map(manifest.cases.map(c=>["/"+c.object_key,c.local_image]));
 h.env.ASSETS={fetch:async req=>{const file=images.get(new URL(req.url).pathname);return file?new Response(fs.readFileSync(file),{headers:{"Content-Type":"image/png"}}):new Response(null,{status:404});}};
 h.env.IMAGE_SERVICE={fetch:req=>imageWorker.fetch(req,h.env)};
}
const mime={".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".svg":"image/svg+xml",".png":"image/png"};
http.createServer(async(req,res)=>{
 try{
 const u=new URL(req.url,h.env.APP_ORIGIN);
 if(u.pathname==="/__qa/start"){res.writeHead(302,{"Set-Cookie":"pano-session="+h.tokens[u.searchParams.get("who")==="bob"?"bob":"alice"]+"; Path=/; HttpOnly; SameSite=Lax",Location:"/play/"});res.end();return;}
 if(u.pathname.startsWith("/api/")){
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
 const request=new Request(u,{method:req.method,headers:req.headers,body:["GET","HEAD"].includes(req.method)?undefined:body});
 const response=await handle(request,h.env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
 if(decodeURIComponent(u.pathname)==="/admin"||decodeURIComponent(u.pathname).startsWith("/admin/")){
  const request=new Request(u,{method:req.method,headers:req.headers});
  const check=await guardAdminPage(request,h.env,()=>adminAssetResponse(request));
  res.writeHead(check.status,Object.fromEntries(check.headers));res.end(await check.text());return;
 }
 const decoded=decodeURIComponent(u.pathname),target=path.resolve(root,"."+decoded+(decoded.endsWith("/")?"index.html":""));
 if(!target.startsWith(root)||!fs.existsSync(target)){res.writeHead(404);res.end("Not found");return;}
 res.writeHead(200,{"Content-Type":mime[path.extname(target)]||"application/octet-stream","Cache-Control":"no-store"});res.end(fs.readFileSync(target));
 }catch(e){res.writeHead(500);res.end(e.message);}
}).listen(port,"127.0.0.1",()=>console.log("Isolated QA preview: "+h.env.APP_ORIGIN+"/__qa/start (answers stay in temporary memory, never production)"));
