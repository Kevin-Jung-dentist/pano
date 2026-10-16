// PayPal Orders v2. Price, ownership and entitlements are controlled only by this server.
import {now} from './auth.mjs';
export const purchaseTerms='lod-single-set-2026-10-17';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
const openStates="'creating','created','pending'";
const idOk=id=>typeof id==='string'&&/^[A-Za-z0-9-]{8,80}$/.test(id);
function settings(env){
 const mode=env.PAYPAL_MODE,amount=env.PAYPAL_PRICE_USD||'19.00';
 const valid=/^[0-9]{1,5}\.[0-9]{2}$/.test(amount)&&Number(amount)>0;
 const configured=!!(env.DB&&['sandbox','live'].includes(mode)&&env.PAYPAL_CLIENT_ID&&env.PAYPAL_CLIENT_SECRET&&env.PAYPAL_MERCHANT_ID&&env.PAYPAL_WEBHOOK_ID&&valid);
 return {mode,amount,currency:'USD',configured,ready:configured&&env.PAYPAL_ENABLED==='true'};
}
export function publicConfig(env){const s=settings(env);return {ready:s.ready,price:{currency:'USD',value:s.amount},product:'single_set',questions:10,auto_renew:false,terms_version:purchaseTerms,sandbox:s.mode==='sandbox'};}
function requireSettings(env,row){const s=settings(env);if(!s.configured||(row&&(row.mode!==s.mode||row.merchant_id!==env.PAYPAL_MERCHANT_ID)))fail(503,'paymentUnavailable');return s;}
function host(mode){return mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';}
async function paypal(env,path,{method='GET',data,raw,requestId}={}){
 const s=requireSettings(env),base=host(s.mode);
 let response;
 try{response=await fetch(base+'/v1/oauth2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+btoa(env.PAYPAL_CLIENT_ID+':'+env.PAYPAL_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});}catch{fail(502,'paymentServiceError');}
 const token=await response.json().catch(()=>null);if(!response.ok||!token?.access_token)fail(502,'paymentServiceError');
 try{response=await fetch(base+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',Prefer:'return=representation',...(requestId?{'PayPal-Request-Id':requestId}:{})},body:raw??(data?JSON.stringify(data):undefined)});}catch{fail(502,'paymentServiceError');}
 const result=await response.json().catch(()=>null);if(!response.ok||!result)fail(502,'paymentServiceError');return result;
}
export async function credit(db,uid){return q(db,`SELECT p.* FROM game_payments p WHERE p.user_id=? AND p.status='completed' AND NOT EXISTS(SELECT 1 FROM game_payment_uses u WHERE u.order_id=p.id) ORDER BY p.created_at LIMIT 1`,uid).first();}
export async function openOrder(db,uid){return q(db,`SELECT * FROM game_payments WHERE user_id=? AND status IN (${openStates}) ORDER BY created_at DESC LIMIT 1`,uid).first();}
function summary(row){return row?{id:row.id,status:row.status,price:{value:row.amount,currency:row.currency},approval_url:['creating','created'].includes(row.status)?row.approval_url:null}:null;}
export async function account(db,uid){const available=await credit(db,uid),pending=await openOrder(db,uid);return {credits:available?1:0,pending:summary(pending)};}
export function useCredit(db,payment,uid,rid){
 // NOT NULL + unique order_id make consuming the credit atomic with creating the round.
 return q(db,`INSERT INTO game_payment_uses(order_id,round_id,used_at) VALUES((SELECT id FROM game_payments WHERE id=? AND user_id=? AND status='completed' AND NOT EXISTS(SELECT 1 FROM game_payment_uses WHERE order_id=?)),?,?)`,payment.id,uid,payment.id,rid,now());
}
async function owned(db,id,uid){const row=idOk(id)?await q(db,'SELECT * FROM game_payments WHERE id=? AND user_id=?',id,uid).first():null;if(!row)fail(404,'paymentNotFound');return row;}
async function enoughQuestions(env,uid){
 if(!env.IMAGES&&!env.IMAGE_SERVICE)fail(409,'paymentNoQuestions');
 const n=await q(env.DB,`SELECT COUNT(*) n FROM game_cases c WHERE c.active=1 AND c.kind='verified' AND NOT EXISTS(SELECT 1 FROM game_round_cases rc WHERE rc.case_id=c.id AND rc.user_id=?)`,uid).first();
 if(n.n<10)fail(409,'paymentNoQuestions');
}
function validateOrder(order,row){
 const units=order.purchase_units;
 if(order.id!==row.paypal_order_id||order.intent!=='CAPTURE'||units?.length!==1)fail(502,'paymentVerificationFailed');
 const unit=units[0];
 if(unit.custom_id!==row.id||unit.amount?.currency_code!==row.currency||unit.amount?.value!==row.amount||unit.payee?.merchant_id!==row.merchant_id)fail(502,'paymentVerificationFailed');
 return unit;
}
async function settle(env,row,order){
 const unit=validateOrder(order,row),captures=unit.payments?.captures||[];
 if(captures.length>1)fail(502,'paymentVerificationFailed');
 const capture=captures[0];
 if(capture){
  if(!idOk(capture.id)||capture.amount?.currency_code!==row.currency||capture.amount?.value!==row.amount||capture.final_capture!==true)fail(502,'paymentVerificationFailed');
  if(row.capture_id&&row.capture_id!==capture.id)fail(502,'paymentVerificationFailed');
  const state={COMPLETED:'completed',PENDING:'pending',DECLINED:'failed',FAILED:'failed',REFUNDED:'refunded',PARTIALLY_REFUNDED:'refunded',REVERSED:'reversed'}[capture.status];
  if(state){
   if(state==='completed'&&order.status!=='COMPLETED')fail(502,'paymentVerificationFailed');
   await q(env.DB,`UPDATE game_payments SET status=?,capture_id=?,updated_at=? WHERE id=? AND status NOT IN ('refunded','reversed') AND (status<>'cancelled' OR ? IN ('completed','refunded','reversed')) AND (status<>'completed' OR ? IN ('completed','refunded','reversed'))`,state,capture.id,now(),row.id,state,state).run();
  }
 }else if(order.status==='VOIDED')await q(env.DB,"UPDATE game_payments SET status='cancelled',updated_at=? WHERE id=? AND status IN ('created','creating')",now(),row.id).run();
 return q(env.DB,'SELECT * FROM game_payments WHERE id=?',row.id).first();
}
async function createRemote(env,row){
 requireSettings(env,row);
 if(row.paypal_order_id)return summary(row);
 // Never replay an unknown create beyond PayPal's default six-hour idempotency window.
 if(now()-row.created_at>5*3600)fail(409,'paymentContactOwner');
 const data=await paypal(env,'/v2/checkout/orders',{method:'POST',requestId:row.create_request_id,data:{intent:'CAPTURE',purchase_units:[{reference_id:'default',custom_id:row.id,description:'League of Doctors - one 10-question full-feedback set',payee:{merchant_id:row.merchant_id},amount:{currency_code:row.currency,value:row.amount}}],payment_source:{paypal:{experience_context:{brand_name:'League of Doctors',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:env.APP_ORIGIN+'/?paypal=return&payment='+row.id,cancel_url:env.APP_ORIGIN+'/?paypal=cancel&payment='+row.id}}}}});
 const approval=data.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href;
 let url;try{url=new URL(approval);}catch{fail(502,'paymentVerificationFailed');}
 const allowed=row.mode==='live'?'www.paypal.com':'www.sandbox.paypal.com';
 if(!idOk(data.id)||url.protocol!=='https:'||url.hostname!==allowed||url.port||url.username||url.password)fail(502,'paymentVerificationFailed');
 await q(env.DB,"UPDATE game_payments SET paypal_order_id=?,approval_url=?,status='created',updated_at=? WHERE id=? AND status='creating'",data.id,url.href,now(),row.id).run();
 return summary(await q(env.DB,'SELECT * FROM game_payments WHERE id=?',row.id).first());
}
export async function create(env,u,b){
 const s=settings(env);if(!s.ready)fail(503,'paymentUnavailable');
 if(b.terms_version!==purchaseTerms)fail(400,'paymentAcceptTerms');
 if(u.feedback_plan==='full'||await credit(env.DB,u.id))fail(409,'paymentUseCredit');
 let row=await openOrder(env.DB,u.id);if(row)return createRemote(env,row);
 if(await q(env.DB,"SELECT id FROM game_rounds WHERE user_id=? AND state='active'",u.id).first())fail(409,'paymentFinishRound');
 await enoughQuestions(env,u.id);
 const id=crypto.randomUUID(),time=now();
 try{await q(env.DB,`INSERT INTO game_payments(id,user_id,status,mode,merchant_id,currency,amount,create_request_id,capture_request_id,terms_version,created_at,updated_at) VALUES(?,?,'creating',?,?,?,?,?,?,?,?,?)`,id,u.id,s.mode,env.PAYPAL_MERCHANT_ID,s.currency,s.amount,crypto.randomUUID(),crypto.randomUUID(),purchaseTerms,time,time).run();}
 catch(e){row=await openOrder(env.DB,u.id);if(!row)throw e;return createRemote(env,row);}
 row=await owned(env.DB,id,u.id);return createRemote(env,row);
}
async function confirmRow(env,row){
 requireSettings(env,row);
 if(!row.paypal_order_id)return row;
 const order=await paypal(env,'/v2/checkout/orders/'+row.paypal_order_id);
 validateOrder(order,row);
 if(order.status!=='APPROVED')return settle(env,row,order);
 if(!row.user_id||['cancelled','failed','refunded','reversed','completed'].includes(row.status))return row;
 await enoughQuestions(env,row.user_id);
 // Taking this lock before capture makes a simultaneous cancel unable to release the order.
 await q(env.DB,"UPDATE game_payments SET status='pending',updated_at=? WHERE id=? AND status IN ('created','pending')",now(),row.id).run();
 row=await q(env.DB,'SELECT * FROM game_payments WHERE id=?',row.id).first();
 if(row.status!=='pending')return row;
 try{await paypal(env,'/v2/checkout/orders/'+row.paypal_order_id+'/capture',{method:'POST',requestId:row.capture_request_id,data:{}});}catch(e){
  // An unknown capture outcome is reconciled, never replaced by a new charge.
  const result=await paypal(env,'/v2/checkout/orders/'+row.paypal_order_id);
  if(!result.purchase_units?.[0]?.payments?.captures?.length)throw e;
  return settle(env,row,result);
 }
 return settle(env,row,await paypal(env,'/v2/checkout/orders/'+row.paypal_order_id));
}
export async function confirm(env,id,uid){return summary(await confirmRow(env,await owned(env.DB,id,uid)));}
export async function get(env,id,uid){
 let row=await owned(env.DB,id,uid);
 if(row.paypal_order_id&&['created','pending'].includes(row.status)){requireSettings(env,row);row=await settle(env,row,await paypal(env,'/v2/checkout/orders/'+row.paypal_order_id));}
 return summary(row);
}
export async function cancel(env,id,uid){
 const row=await owned(env.DB,id,uid);
 await q(env.DB,"UPDATE game_payments SET status='cancelled',updated_at=? WHERE id=? AND status IN ('creating','created')",now(),row.id).run();
 return summary(await owned(env.DB,id,uid));
}
export async function webhook(req,env){
 requireSettings(env);
 const reader=req.body?.getReader();let raw='',size=0;const decoder=new TextDecoder();
 if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();fail(413,'paymentInvalidWebhook');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let event;try{event=JSON.parse(raw);}catch{fail(400,'paymentInvalidWebhook');}
 const fields={auth_algo:req.headers.get('paypal-auth-algo'),cert_url:req.headers.get('paypal-cert-url'),transmission_id:req.headers.get('paypal-transmission-id'),transmission_sig:req.headers.get('paypal-transmission-sig'),transmission_time:req.headers.get('paypal-transmission-time'),webhook_id:env.PAYPAL_WEBHOOK_ID};
 if(Object.values(fields).some(v=>!v)||!idOk(event.id))fail(400,'paymentInvalidWebhook');
 // Preserve original JSON for PayPal's signature verification; never fetch a caller-supplied certificate URL.
 const verify=await paypal(env,'/v1/notifications/verify-webhook-signature',{method:'POST',raw:JSON.stringify(fields).slice(0,-1)+',"webhook_event":'+raw+'}'});
 if(verify.verification_status!=='SUCCESS')fail(400,'paymentInvalidWebhook');
 if(await q(env.DB,'SELECT id FROM game_payment_events WHERE id=?',event.id).first())return {ok:true};
 const supported=['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'];
 if(!supported.includes(event.event_type))return {ok:true};
 const resource=event.resource||{},orderId=event.event_type==='CHECKOUT.ORDER.APPROVED'?resource.id:resource.supplementary_data?.related_ids?.order_id;
 let row=idOk(orderId)?await q(env.DB,'SELECT * FROM game_payments WHERE paypal_order_id=?',orderId).first():null;
 if(!row){
  let captureId=resource.supplementary_data?.related_ids?.capture_id;
  if(event.event_type==='PAYMENT.CAPTURE.REVERSED')captureId=resource.id;
  if(!captureId){for(const link of resource.links||[]){try{const u=new URL(link.href);if([host(settings(env).mode),host(settings(env).mode).replace('api-m.','api.')].includes(u.origin))captureId=u.pathname.match(/^\/v2\/payments\/captures\/([A-Za-z0-9-]+)$/)?.[1]||captureId;}catch{}}}
  if(idOk(captureId)){
   row=await q(env.DB,'SELECT * FROM game_payments WHERE capture_id=?',captureId).first();
   // A refund can beat the original capture response to our database.
   if(!row){const capture=await paypal(env,'/v2/payments/captures/'+captureId),related=capture.supplementary_data?.related_ids?.order_id;
    if(capture.id===captureId&&idOk(related))row=await q(env.DB,'SELECT * FROM game_payments WHERE paypal_order_id=?',related).first();}
  }
 }
 if(!row)return {ok:true};
 requireSettings(env,row);
 if(['PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'].includes(event.event_type)){
  const status=event.event_type.endsWith('REFUNDED')?'refunded':'reversed';
  await env.DB.batch([q(env.DB,'UPDATE game_payments SET status=?,updated_at=? WHERE id=?',status,now(),row.id),q(env.DB,'INSERT OR IGNORE INTO game_payment_events VALUES(?,?,?,?)',event.id,row.id,event.event_type,now())]);
 }else{
  if(event.event_type==='CHECKOUT.ORDER.APPROVED')await confirmRow(env,row);
  else await settle(env,row,await paypal(env,'/v2/checkout/orders/'+row.paypal_order_id));
  await q(env.DB,'INSERT OR IGNORE INTO game_payment_events VALUES(?,?,?,?)',event.id,row.id,event.event_type,now()).run();
 }
 return {ok:true};
}
