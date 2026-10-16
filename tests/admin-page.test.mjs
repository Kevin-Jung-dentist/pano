import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {harness} from './game-harness.mjs';
import {guardAdminPage,adminAssetResponse} from '../server/admin-page.mjs';
import {adminAssets} from '../server/admin-assets.mjs';
test('page and assets fail closed for anonymous, non-admin and expired sessions',async()=>{
 const h=await harness();let passed=0;
 const req=(path,who)=>new Request(h.env.APP_ORIGIN+path,{headers:{Cookie:'pano-session='+h.tokens[who]}});
 for(const path of ['/admin','/admin/','/admin/index.html','/admin/new/','/admin/new/index.html','/admin/new/create.js','/admin/admin.css','/%61dmin/new/','/admin/%6eew/index.html'])for(const who of ['anonymous','bob']){
  const res=await guardAdminPage(req(path,who),h.env,async()=>{passed++;return new Response('private');});assert.equal(res.status,404);assert.equal(await res.text(),'Not found');assert.match(res.headers.get('Cache-Control'),/no-store/);
 }
 assert.equal(passed,0);
 h.DB.db.prepare('INSERT INTO game_admins VALUES(?,?)').run('alice',1);
 h.DB.db.prepare("UPDATE game_sessions SET expires_at=1 WHERE user_id='alice'").run();
 assert.equal((await guardAdminPage(req('/admin/','alice'),h.env,()=>{passed++;})).status,404);assert.equal(passed,0);
});
test('administrator files are server-only and authenticated responses serve the matching source',async()=>{
 assert.equal(fs.existsSync('dist/admin'),false,'static file hosting must not bypass authorization');
 for(const [path,asset] of Object.entries(adminAssets))assert.equal(asset.content,fs.readFileSync(path.slice(1),'utf8'));
 const h=await harness();h.DB.db.prepare('INSERT INTO game_admins VALUES(?,?)').run('alice',1);
 for(const [path,needle] of [['/admin/','demo-count'],['/admin/new/','create-demo-form'],['/%61dmin/new/','create-demo-form'],['/admin/new/create.js','requestId'],['/admin/admin.css','.admin-main']]){
  const request=new Request(h.env.APP_ORIGIN+path,{headers:{Cookie:'pano-session='+h.tokens.alice}});
  const response=await guardAdminPage(request,h.env,()=>adminAssetResponse(request));
  assert.equal(response.status,200);assert.ok((await response.text()).includes(needle));assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 }
 const head=new Request(h.env.APP_ORIGIN+'/admin/new/',{method:'HEAD'});
 assert.equal(await adminAssetResponse(head).text(),'');
 assert.equal(adminAssetResponse(new Request(h.env.APP_ORIGIN+'/admin/missing')).status,404);
 assert.equal(adminAssetResponse(new Request(h.env.APP_ORIGIN+'/admin/new/',{method:'POST'})).status,405);
 assert.equal(adminAssetResponse(new Request(h.env.APP_ORIGIN+'/')),null);
});
test('owner receives private uncached content, normal routes bypass guard, missing configuration denies access',async()=>{
 const h=await harness();h.DB.db.prepare('INSERT INTO game_admins VALUES(?,?)').run('alice',1);
 const req=new Request(h.env.APP_ORIGIN+'/admin/new/',{headers:{Cookie:'pano-session='+h.tokens.alice}});
 const res=await guardAdminPage(req,h.env,async()=>new Response('private page',{headers:{'Content-Type':'text/html','Cache-Control':'public,max-age=3600'}}));
 assert.equal(res.status,200);assert.equal(await res.text(),'private page');assert.equal(res.headers.get('Cache-Control'),'private, no-store');assert.equal(res.headers.get('Vary'),'Cookie');assert.match(res.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 for(const env of [{}, {...h.env,DB:null}, {...h.env,APP_ORIGIN:'https://wrong.example'}])assert.equal((await guardAdminPage(req,env,()=>new Response('private'))).status,404);
 assert.equal(await (await guardAdminPage(new Request(h.env.APP_ORIGIN+'/api/config'),{},()=>new Response('normal'))).text(),'normal');
 const routes=JSON.parse(fs.readFileSync('dist/_routes.json','utf8'));assert.ok(routes.include.includes('/admin'));assert.ok(routes.include.includes('/admin/*'));
 // Previously public assets may remain in edge caches. Invoke authorization even
 // when an administrator path uses percent encoding before its first slash.
 for(const path of ['/%61dmin/new/','/a%64min/','/ad%6din/','/adm%69n/','/admi%6e/','/admin%2fnew/'])assert.ok(routes.include.some(pattern=>new RegExp('^'+pattern.replaceAll('*','.*')+'$').test(path)),path);
 assert.ok(!fs.readFileSync('dist/index.html','utf8').includes('admin-link'));
});
