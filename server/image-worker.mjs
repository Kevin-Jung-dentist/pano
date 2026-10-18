// Private static image service. Both public URLs are disabled in its generated config.
// Session + assignment checks still run before assets, even if routing is misconfigured.
import * as Auth from './auth.mjs';
export default {
 async fetch(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/images\/([a-zA-Z0-9_-]+)$/);
  const reject = status => new Response('Image unavailable', {status, headers:{'Cache-Control':'no-store'}});
  if (request.method !== 'GET' || url.origin !== env.APP_ORIGIN || !match) return reject(404);
  if (!env.DB || !env.ASSETS) return reject(503);
  const user = await Auth.session(request, env);
  if (!user) return reject(401);
  if (!user.consent_at) return reject(409);
  const assigned = await env.DB.prepare(`SELECT c.object_key FROM game_cases c
   JOIN game_round_cases rc ON rc.case_id=c.id JOIN game_rounds r ON r.id=rc.round_id
   WHERE c.id=? AND r.id=? AND r.user_id=? AND (r.rule_version<>'lod-score-3' OR rc.started_at IS NOT NULL)`).bind(match[1],url.searchParams.get('round'),user.id).first();
  if (!assigned || !/^lod\/hanoi\/[a-zA-Z0-9_-]+\.png$/.test(assigned.object_key)) return reject(404);
  // Never forward cookies, range/cache headers, or user-supplied paths to the asset server.
  const image = await env.ASSETS.fetch(new Request('https://assets.internal/'+assigned.object_key));
  if (image.status !== 200 || !image.headers.get('Content-Type')?.startsWith('image/png')) return reject(404);
  return new Response(image.body,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}});
 }
};
