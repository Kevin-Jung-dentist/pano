"use strict";
// Redirect checkout keeps PayPal credentials and charge confirmation on the server.
window.LoDPayments=function({api,state,refresh,profile,launch}){
 const $=id=>document.getElementById(id),t=(k,v)=>LoDI18n.t(k,v);
 let busy=false,message='',activePayment=null;
 function price(){const current=state(),p=current.paymentAccount.pending?.price||current.config.payments?.price;return p?p.currency+' '+Number(p.value).toFixed(2):'USD 19.00';}
 function render(){
  const {config,me,paymentAccount}=state(),ready=!!config.payments_ready,credit=paymentAccount.credits>0||me?.feedback_plan==='full';
  $('premium-price').textContent=price();$('start-premium-price').textContent=price();
  $('payment-consent-label').textContent=t('paymentConsent',{price:price()});
  $('payment-status').textContent=message||(credit?t('paymentCreditReady'):!ready?t('paymentNotConnected'):paymentAccount.pending?t('paymentInProgress'):t('paymentReady'));
  $('paypal-checkout').disabled=busy||!ready||credit||!$('payment-consent').checked;
  $('paypal-checkout').textContent=t(me?'payWithPaypal':'loginBeforePayment');
  $('payment-check').hidden=!paymentAccount.pending;$('payment-check').disabled=busy;
  $('payment-cancel').hidden=!paymentAccount.pending;$('payment-cancel').disabled=busy;
  $('payment-start').hidden=!credit;$('payment-start').disabled=busy;
  $('payment-consent').disabled=busy||credit;
  $('paypal-checkout').hidden=credit;
  $('payment-sandbox').hidden=!config.payments?.sandbox;
 }
 function open(){message='';$('before-start').close();render();if(!$('premium-dialog').open)$('premium-dialog').showModal();}
 function error(e){message=LoDI18n.error(e.message);render();}
 async function checkout(){
  if(busy)return;const {config,me}=state();if(!config.payments_ready)return;
  if(!me){if(!config.auth_ready){message=t('notReady');render();return;}try{sessionStorage.setItem('lod-open-payment','1');}catch{}location.assign('/api/auth/start');return;}
  if(!me.profile_complete){$('premium-dialog').close();profile();return;}
  busy=true;message=t('paymentConnecting');render();
  try{const order=await api('payments/paypal/orders',{terms_version:config.payments.terms_version});activePayment=order.id;
   await refresh();
   if(order.approval_url){location.assign(order.approval_url);return;}
   message=t(order.status==='completed'?'paymentSuccess':'paymentInProgress');
  }catch(e){error(e);}finally{busy=false;render();}
 }
 async function update(id,cancel=false){
  if(busy)return;busy=true;message=t('paymentChecking');render();
  try{const order=await api('payments/paypal/orders/'+id+'/'+(cancel?'cancel':'capture'),{});activePayment=id;await refresh();
   message=t(({completed:'paymentSuccess',cancelled:'paymentCancelled',failed:'paymentFailed',refunded:'paymentRevoked',reversed:'paymentRevoked'})[order.status]||'paymentInProgress');
   const url=new URL(location.href);for(const key of ['paypal','payment','token','PayerID'])url.searchParams.delete(key);history.replaceState(null,'',url);
   try{sessionStorage.removeItem('lod-payment-return');}catch{}
  }catch(e){error(e);}finally{busy=false;render();}
 }
 async function returned(){
  let search=location.search;try{search=search.includes('paypal=')?search:sessionStorage.getItem('lod-payment-return')||search;}catch{}
  const p=new URLSearchParams(search),id=p.get('payment'),action=p.get('paypal');
  if(id&&/^[A-Za-z0-9-]{8,80}$/.test(id)&&['return','cancel'].includes(action)){
   open();activePayment=id;
   if(!state().me){try{sessionStorage.setItem('lod-payment-return',search);}catch{}message=t('paymentLoginAgain');render();return;}
   await update(id,action==='cancel');return;
  }
  try{if(sessionStorage.getItem('lod-open-payment')){sessionStorage.removeItem('lod-open-payment');open();}}catch{}
 }
 $('premium-start').onclick=open;$('premium-results').onclick=open;$('close-premium').onclick=()=>$('premium-dialog').close();
 $('paypal-checkout').onclick=checkout;$('payment-consent').onchange=render;
 $('payment-check').onclick=()=>update(state().paymentAccount.pending?.id||activePayment);
 $('payment-cancel').onclick=()=>update(state().paymentAccount.pending?.id||activePayment,true);
 $('payment-start').onclick=()=>{$('premium-dialog').close();launch();};
 document.addEventListener('lod-language',()=>{message='';render();});
 return {open,render,returned};
};
