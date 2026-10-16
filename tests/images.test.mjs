import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './game-harness.mjs';
import {handle} from '../server/api.mjs';
import imageWorker from '../server/image-worker.mjs';

test('private image service checks session and assignment before serving unchanged bytes',async()=>{
 const h=await harness();
 await h.DB.prepare("UPDATE game_cases SET object_key='lod/hanoi/'||id||'.png'").run();
 const round=await (await handle(h.req('rounds',{}),h.env)).json();
 const path='images/'+round.items[0].id+'?round='+round.id;
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10,12,35]);let calls=0;
 h.env.ASSETS={fetch:async req=>{calls++;assert.equal(req.headers.get('Cookie'),null);assert.equal(new URL(req.url).pathname,'/lod/hanoi/'+round.items[0].id+'.png');return new Response(bytes,{headers:{'Content-Type':'image/png'}});}};
 h.env.IMAGE_SERVICE={fetch:req=>imageWorker.fetch(req,h.env)};
 const good=await handle(h.req(path),h.env);assert.equal(good.status,200);assert.deepEqual(new Uint8Array(await good.arrayBuffer()),bytes);assert.equal(good.headers.get('Cache-Control'),'private, no-store');
 assert.equal((await handle(h.req(path,undefined,'bob'),h.env)).status,404);
 assert.equal((await imageWorker.fetch(new Request(h.env.APP_ORIGIN+'/api/'+path),h.env)).status,401);
 assert.equal((await imageWorker.fetch(h.req('../lod/hanoi/'+round.items[0].id+'.png'),h.env)).status,404);
 assert.equal((await imageWorker.fetch(new Request('https://wrong.invalid/api/'+path),h.env)).status,404);
 assert.equal(calls,1);
 h.env.ASSETS.fetch=async()=>new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}});
 assert.equal((await handle(h.req(path),h.env)).status,404);
});

test('bank readiness requires both available references and image service',async()=>{
 const h=await harness();const ready=async()=> (await (await handle(h.req('config'),h.env)).json()).game_ready;
 assert.equal(await ready(),true);delete h.env.IMAGES;assert.equal(await ready(),false);
 assert.equal((await handle(h.req('rounds',{}),h.env)).status,503);
 assert.equal((await h.DB.prepare('SELECT COUNT(*) n FROM game_rounds').first()).n,0);
 h.env.IMAGE_SERVICE={fetch:async()=>new Response()};assert.equal(await ready(),true);
 await h.DB.prepare("UPDATE game_cases SET active=0 WHERE kind='verified'").run();assert.equal(await ready(),false);
});
