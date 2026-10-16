import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,ref} from './game-harness.mjs';
import {handle} from '../server/api.mjs';
import {purchaseTerms} from '../server/payments.mjs';

async function setup(t){
 const h=await harness();Object.assign(h.env,{PAYPAL_ENABLED:'true',PAYPAL_MODE:'sandbox',PAYPAL_CLIENT_ID:'test-client',PAYPAL_CLIENT_SECRET:'test-secret',PAYPAL_MERCHANT_ID:'TESTMERCHANT',PAYPAL_WEBHOOK_ID:'TEST-WEBHOOK',PAYPAL_PRICE_USD:'19.00'});
 const orders=new Map(),requests=[],createKeys=new Map();let captureCalls=0,loseCreate=false,loseCapture=false;
 const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  const u=new URL(url);assert.equal(u.origin,'https://api-m.sandbox.paypal.com');const data=options.body?JSON.parse(options.body.startsWith('{')?options.body:'{}'):{};
  if(u.pathname==='/v1/oauth2/token')return response({access_token:'test-only-token'});
  requests.push({path:u.pathname,method:options.method,data,requestId:options.headers['PayPal-Request-Id']});
  if(u.pathname==='/v1/notifications/verify-webhook-signature')return response({verification_status:data.transmission_sig==='valid'?'SUCCESS':'FAILURE'});
  if(u.pathname==='/v2/checkout/orders'){
   const key=options.headers['PayPal-Request-Id'];assert.ok(key);let id=createKeys.get(key);
   if(!id){id='PAYPALORDER'+String(orders.size+1).padStart(6,'0');createKeys.set(key,id);orders.set(id,{id,status:'PAYER_ACTION_REQUIRED',intent:data.intent,purchase_units:structuredClone(data.purchase_units),links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token='+id}]});}
   if(loseCreate){loseCreate=false;throw Error('Network failed after creating');}return response(orders.get(id));
  }
  if(u.pathname.startsWith('/v2/payments/captures/')){
   for(const order of orders.values()){const capture=order.purchase_units[0].payments?.captures?.find(c=>u.pathname.endsWith('/'+c.id));if(capture)return response({...capture,supplementary_data:{related_ids:{order_id:order.id}}});}
   throw Error('Unexpected capture lookup');
  }
  const match=u.pathname.match(/^\/v2\/checkout\/orders\/(PAYPALORDER\d+)(\/capture)?$/);assert.ok(match,u.pathname);const order=orders.get(match[1]);assert.ok(order);
  if(match[2]){captureCalls++;assert.ok(options.headers['PayPal-Request-Id']);if(order.status!=='COMPLETED'){
   assert.equal(order.status,'APPROVED');order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:'CAPTURE'+order.id,status:'COMPLETED',amount:structuredClone(order.purchase_units[0].amount),final_capture:true}]};
  }if(loseCapture){loseCapture=false;throw Error('Network failed after capture');}}
  return response(order);
 });
 const call=async(path,b,who='alice',origin)=>{const res=await handle(h.req(path,b,who,origin),h.env);return {status:res.status,data:await res.json()};};
 const create=async()=>{const result=await call('payments/paypal/orders',{terms_version:purchaseTerms,amount:'0.01',currency:'AAA',user_id:'bob',feedback_plan:'full'});assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
 const approve=p=>{const row=h.DB.db.prepare('SELECT * FROM game_payments WHERE id=?').get(p.id);orders.get(row.paypal_order_id).status='APPROVED';return row;};
 const webhook=async(type,row,{signature='valid',id='WH-EVENT-'+crypto.randomUUID(),resource}={})=>{
  const event={id,event_type:type,resource:resource||{id:row.paypal_order_id,supplementary_data:{related_ids:{order_id:row.paypal_order_id}}}};
  const req=new Request(h.env.APP_ORIGIN+'/api/payments/paypal/webhook',{method:'POST',headers:{'Content-Type':'application/json','paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/TEST','paypal-transmission-id':'transmission-test','paypal-transmission-time':new Date().toISOString(),'paypal-transmission-sig':signature},body:JSON.stringify(event,null,2)});
  const res=await handle(req,h.env);return {status:res.status,data:await res.json()};
 };
 return {...h,call,create,approve,webhook,orders,requests,get captureCalls(){return captureCalls;},loseCreate(){loseCreate=true;},loseCapture(){loseCapture=true;}};
}

test('checkout stays closed without credentials and never calls PayPal',async t=>{
 const h=await setup(t);delete h.env.PAYPAL_CLIENT_SECRET;
 const config=(await h.call('config')).data;assert.equal(config.payments_ready,false);assert.deepEqual(config.payments.price,{currency:'USD',value:'19.00'});
 assert.equal((await h.call('payments/paypal/orders',{terms_version:purchaseTerms})).status,503);assert.equal(h.requests.length,0);
});
test('server owns USD 19 price, buyer, merchant and one-time product; repeat create reuses one order',async t=>{
 const h=await setup(t),p=await h.create(),again=await h.create();assert.equal(p.id,again.id);assert.equal(h.orders.size,1);
 const order=[...h.orders.values()][0],unit=order.purchase_units[0];assert.deepEqual(unit.amount,{currency_code:'USD',value:'19.00'});assert.equal(unit.payee.merchant_id,'TESTMERCHANT');assert.equal(unit.custom_id,p.id);
 assert.equal(h.DB.db.prepare('SELECT user_id FROM game_payments').get().user_id,'alice');assert.equal((await h.call('me')).data.payments.credits,0);
 assert.equal((await h.call('rounds',{})).status,409);assert.equal((await h.call('account/delete',{confirm:'DELETE'})).status,409);
});
test('network failure after remote create retries the same PayPal idempotency key',async t=>{
 const h=await setup(t);h.loseCreate();assert.equal((await h.call('payments/paypal/orders',{terms_version:purchaseTerms})).status,502);
 const p=await h.create();assert.ok(p.approval_url);assert.equal(h.orders.size,1);
 const keys=h.requests.filter(r=>r.path==='/v2/checkout/orders').map(r=>r.requestId);assert.equal(keys[0],keys[1]);
});
test('one verified capture grants one set; retries, duplicate webhooks and concurrent start cannot double grant or spend',async t=>{
 const h=await setup(t),p=await h.create(),row=h.approve(p);h.loseCapture();
 assert.equal((await h.call('payments/paypal/orders/'+p.id+'/capture',{})).data.status,'completed');
 assert.equal((await h.call('payments/paypal/orders/'+p.id+'/capture',{})).data.status,'completed');assert.equal(h.captureCalls,1);
 const event={id:'WH-DUPLICATE-00001'};assert.equal((await h.webhook('PAYMENT.CAPTURE.COMPLETED',row,event)).status,200);await h.webhook('PAYMENT.CAPTURE.COMPLETED',row,event);
 assert.equal((await h.call('me')).data.payments.credits,1);assert.equal((await h.call('payments/paypal/orders',{terms_version:purchaseTerms})).status,409);
 const rounds=await Promise.all([h.call('rounds',{}),h.call('rounds',{})]);assert.equal(rounds[0].data.id,rounds[1].data.id);
 const round=rounds[0].data;assert.equal(round.feedback_mode,'full');assert.equal(round.scored_target,10);assert.equal(round.items.length,10);assert.equal((await h.call('me')).data.payments.credits,0);
 assert.equal(h.DB.db.prepare('SELECT COUNT(*) n FROM game_payment_uses').get().n,1);
 for(const item of round.items)await h.call('rounds/'+round.id+'/cases/'+item.id+'/submit',{boxes:ref,revision:0});
 const finished=(await h.call('rounds/'+round.id)).data;assert.ok(finished.result.details.every(d=>d.scored&&d.reference));assert.equal(finished.result.score,100);
 const next=(await h.call('rounds',{})).data;assert.equal(next.feedback_mode,'free');assert.equal(next.scored_target,3);
});
test('cancelled unapproved order cannot later be charged, and fake approval query cannot issue a pass',async t=>{
 const h=await setup(t),p=await h.create();assert.equal((await h.call('payments/paypal/orders/'+p.id+'/capture',{})).data.status,'created');assert.equal(h.captureCalls,0);
 assert.equal((await h.call('payments/paypal/orders/'+p.id+'/cancel',{})).data.status,'cancelled');const row=h.approve(p);
 await h.webhook('CHECKOUT.ORDER.APPROVED',row);assert.equal(h.captureCalls,0);assert.equal((await h.call('me')).data.payments.credits,0);
 assert.equal((await h.call('rounds',{})).status,200);
});
test('foreign users, cross-site posts and invalid webhook signatures cannot access or grant payments',async t=>{
 const h=await setup(t),p=await h.create(),row=h.approve(p);
 for(const suffix of ['', '/capture','/cancel'])assert.equal((await h.call('payments/paypal/orders/'+p.id+suffix,suffix?{}:undefined,'bob')).status,404);
 assert.equal((await h.call('payments/paypal/orders',{terms_version:purchaseTerms},'alice','https://evil.invalid')).status,403);
 assert.equal((await h.webhook('CHECKOUT.ORDER.APPROVED',row,{signature:'invalid'})).status,400);assert.equal(h.captureCalls,0);assert.equal((await h.call('me')).data.payments.credits,0);
});
for(const tamper of ['amount','currency','merchant','custom','capture'])test('mismatched '+tamper+' never grants an entitlement',async t=>{
 const h=await setup(t),p=await h.create(),row=h.approve(p),o=h.orders.get(row.paypal_order_id),u=o.purchase_units[0];
 if(tamper==='amount')u.amount.value='1.00';if(tamper==='currency')u.amount.currency_code='EUR';if(tamper==='merchant')u.payee.merchant_id='OTHER';if(tamper==='custom')u.custom_id='OTHER';
 if(tamper==='capture'){o.status='COMPLETED';u.payments={captures:[{id:'CAPTUREINVALID',status:'COMPLETED',amount:{currency_code:'USD',value:'1.00'},final_capture:true}]};}
 assert.equal((await h.call('payments/paypal/orders/'+p.id+'/capture',{})).status,502);assert.equal((await h.call('me')).data.payments.credits,0);
});
test('pending capture does not grant credit, completion webhook recovers a closed browser, refund removes unused credit',async t=>{
 const h=await setup(t),p=await h.create(),row=h.approve(p);await h.webhook('CHECKOUT.ORDER.APPROVED',row);
 assert.equal(h.captureCalls,1);assert.equal((await h.call('me')).data.payments.credits,1);
 const o=h.orders.get(row.paypal_order_id),c=o.purchase_units[0].payments.captures[0];c.status='REFUNDED';
 await h.webhook('PAYMENT.CAPTURE.REFUNDED',row,{resource:{id:'REFUND000001',links:[{rel:'up',href:'https://api.sandbox.paypal.com/v2/payments/captures/'+c.id}]}});
 assert.equal((await h.call('me')).data.payments.credits,0);
 c.status='COMPLETED';await h.webhook('PAYMENT.CAPTURE.COMPLETED',row);assert.equal((await h.call('me')).data.payments.credits,0);
 assert.equal(h.DB.db.prepare('SELECT status FROM game_payments').get().status,'refunded');
});
test('unapproved and pending transactions never count as a paid pass',async t=>{
 const h=await setup(t),p=await h.create(),row=h.approve(p),o=h.orders.get(row.paypal_order_id);
 o.status='COMPLETED';o.purchase_units[0].payments={captures:[{id:'CAPTUREPENDING0001',status:'PENDING',amount:{currency_code:'USD',value:'19.00'},final_capture:true}]};
 await h.webhook('PAYMENT.CAPTURE.PENDING',row);assert.equal((await h.call('me')).data.payments.credits,0);
 assert.equal((await h.call('payments/paypal/orders/'+p.id+'/cancel',{})).data.status,'pending');
 o.purchase_units[0].payments.captures[0].status='COMPLETED';await h.webhook('PAYMENT.CAPTURE.COMPLETED',row);assert.equal((await h.call('me')).data.payments.credits,1);
});
test('insufficient unseen verified questions or active reading blocks purchase before any remote charge',async t=>{
 const h=await setup(t);h.DB.db.exec("UPDATE game_cases SET active=0 WHERE kind='verified' AND id NOT IN ('case0','case1','case2')");
 assert.equal((await h.call('payments/paypal/orders',{terms_version:purchaseTerms})).status,409);assert.equal(h.orders.size,0);
 h.DB.db.exec('UPDATE game_cases SET active=1');await h.call('rounds',{});
 assert.equal((await h.call('payments/paypal/orders',{terms_version:purchaseTerms})).status,409);assert.equal(h.orders.size,0);
});
test('account deletion keeps spent financial records detached from the Google account and does not restore credits',async t=>{
 const h=await setup(t),p=await h.create();h.approve(p);await h.call('payments/paypal/orders/'+p.id+'/capture',{});await h.call('rounds',{});
 assert.equal((await h.call('account/delete',{confirm:'DELETE'})).status,200);
 const payment=h.DB.db.prepare('SELECT * FROM game_payments').get();assert.equal(payment.user_id,null);assert.equal(h.DB.db.prepare('SELECT COUNT(*) n FROM game_payment_uses').get().n,1);
 assert.equal((await h.call('me',undefined,'bob')).data.payments.credits,0);
});

test('refund arriving before local capture persistence cannot be lost or resurrected by an old completion',async t=>{
 const h=await setup(t),p=await h.create(),row=h.approve(p),o=h.orders.get(row.paypal_order_id);
 o.status='COMPLETED';o.purchase_units[0].payments={captures:[{id:'CAPTURERACE0001',status:'COMPLETED',amount:{currency_code:'USD',value:'19.00'},final_capture:true}]};
 await h.webhook('PAYMENT.CAPTURE.REFUNDED',row,{resource:{id:'REFUNDRACE0001',links:[{rel:'up',href:'https://api.sandbox.paypal.com/v2/payments/captures/CAPTURERACE0001'}]}});
 assert.equal(h.DB.db.prepare('SELECT status FROM game_payments').get().status,'refunded');
 await h.call('payments/paypal/orders/'+p.id+'/capture',{});assert.equal((await h.call('me')).data.payments.credits,0);
});
