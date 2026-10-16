import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {harness} from './game-harness.mjs';
import {guardAdminPage} from '../server/admin-page.mjs';
test('page and assets fail closed for anonymous, non-admin and expired sessions',async()=>{
 const h=await harness();let passed=0;
 const req=(path,who)=>new Request(h.env.APP_ORIGIN+path,{headers:{Cookie:'pano-session='+h.tokens[who]}});
 for(const path of ['/admin','/admin/','/admin/index.html','/admin/new/','/admin/new/index.html','/admin/new/create.js','/admin/admin.css'])for(const who of ['anonymous','bob']){
  const res=await guardAdminPage(req(path,who),h.env,async()=>{passed++;return new Response('private');});assert.equal(res.status,404);assert.equal(await res.text(),'Not found');assert.match(res.headers.get('Cache-Control'),/no-store/);
 }
 assert.equal(passed,0);
 h.DB.db.prepare('INSERT INTO game_admins VALUES(?,?)').run('alice',1);
 h.DB.db.prepare("UPDATE game_sessions SET expires_at=1 WHERE user_id='alice'").run();
 assert.equal((await guardAdminPage(req('/admin/','alice'),h.env,()=>{passed++;})).status,404);assert.equal(passed,0);
});
test('owner receives private uncached content, normal routes bypass guard, missing configuration denies access',async()=>{
 const h=await harness();h.DB.db.prepare('INSERT INTO game_admins VALUES(?,?)').run('alice',1);
 const req=new Request(h.env.APP_ORIGIN+'/admin/new/',{headers:{Cookie:'pano-session='+h.tokens.alice}});
 const res=await guardAdminPage(req,h.env,async()=>new Response('private page',{headers:{'Content-Type':'text/html','Cache-Control':'public,max-age=3600'}}));
 assert.equal(res.status,200);assert.equal(await res.text(),'private page');assert.equal(res.headers.get('Cache-Control'),'private, no-store');assert.equal(res.headers.get('Vary'),'Cookie');assert.match(res.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 for(const env of [{}, {...h.env,DB:null}, {...h.env,APP_ORIGIN:'https://wrong.example'}])assert.equal((await guardAdminPage(req,env,()=>new Response('private'))).status,404);
 assert.equal(await (await guardAdminPage(new Request(h.env.APP_ORIGIN+'/api/config'),{},()=>new Response('normal'))).text(),'normal');
 const routes=JSON.parse(fs.readFileSync('dist/_routes.json','utf8'));assert.ok(routes.include.includes('/admin'));assert.ok(routes.include.includes('/admin/*'));
 assert.ok(!fs.readFileSync('dist/index.html','utf8').includes('admin-link'));
});
