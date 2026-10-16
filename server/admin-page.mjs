import * as Auth from './auth.mjs';
import {isAdmin} from './demo-leaderboard.mjs';
const denied=()=>new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Vary':'Cookie'}});
export async function guardAdminPage(request,env,next){
 const url=new URL(request.url);
 if(url.pathname!=='/admin'&&!url.pathname.startsWith('/admin/'))return next();
 try{
  if(!env.DB||!env.APP_ORIGIN||url.origin!==env.APP_ORIGIN)return denied();
  const account=await Auth.session(request,env);
  if(!account||!await isAdmin(env.DB,account.id))return denied();
 }catch{return denied();}
 const result=await next(),response=new Response(result.body,result);
 response.headers.set('Cache-Control','private, no-store');
 response.headers.set('Vary','Cookie');
 response.headers.set('X-Robots-Tag','noindex, nofollow');
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy','no-referrer');
 response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 return response;
}
