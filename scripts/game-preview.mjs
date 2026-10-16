// Isolated localhost QA only. Never bundled into Pages Functions.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {harness} from "../tests/game-harness.mjs";
import {handle} from "../server/api.mjs";
const h=await harness(),root=fileURLToPath(new URL("../dist/",import.meta.url));
h.env.IMAGES={get:async()=>({body:fs.readFileSync(new URL("../tests/fixtures/game-practice.png",import.meta.url))})};
const mime={".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".svg":"image/svg+xml",".png":"image/png"};
http.createServer(async(req,res)=>{
 try{
 const u=new URL(req.url,h.env.APP_ORIGIN);
 if(u.pathname==="/__qa/start"){res.writeHead(302,{"Set-Cookie":"pano-session="+h.tokens.alice+"; Path=/; HttpOnly; SameSite=Lax",Location:"/play/"});res.end();return;}
 if(u.pathname.startsWith("/api/")){
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
 const request=new Request(u,{method:req.method,headers:req.headers,body:["GET","HEAD"].includes(req.method)?undefined:body});
 const response=await handle(request,h.env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
 const decoded=decodeURIComponent(u.pathname),target=path.resolve(root,"."+decoded+(decoded.endsWith("/")?"index.html":""));
 if(!target.startsWith(root)||!fs.existsSync(target)){res.writeHead(404);res.end("Not found");return;}
 res.writeHead(200,{"Content-Type":mime[path.extname(target)]||"application/octet-stream","Cache-Control":"no-store"});res.end(fs.readFileSync(target));
 }catch(e){res.writeHead(500);res.end(e.message);}
}).listen(8789,"127.0.0.1",()=>console.log("Isolated synthetic preview: http://127.0.0.1:8789/play/ | QA session: http://127.0.0.1:8789/__qa/start"));
