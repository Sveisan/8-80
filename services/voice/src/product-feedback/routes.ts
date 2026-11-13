import type { IncomingMessage } from 'node:http';
import { config } from '../config.ts';
import { BROWSER, cookieOf, crossSite } from '../link/cookie.ts';
import { Links } from '../link/token.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { clientBucket, csrfFor, enabled, equal, FEEDBACK_COOKIE, JSON_MAX, newSession, readInput, RETENTION_MS, STATES, validSession, type FeedbackState } from './model.ts';
import { FeedbackConflict, FeedbackLimit, FeedbackStore } from './store.ts';
import { runningRelease } from './release.ts';

interface Answer { status: number; body: string; headers: Record<string,string>; }
const answer = (status: number, data: unknown, headers: Record<string,string> = {}): Answer => ({status,body:JSON.stringify(data),headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...headers,
}});
async function read(req: IncomingMessage, limit = JSON_MAX): Promise<Record<string,unknown> | undefined> {
  let size = 0; const chunks: Buffer[] = [];
  // Drain an oversized body without retaining it so the next keep-alive request
  // cannot race an incompletely consumed stream. The allocation stays bounded.
  for await (const chunk of req) { size += Buffer.byteLength(chunk); if(size<=limit) chunks.push(Buffer.from(chunk)); }
  if(size>limit)return undefined;
  try { const value:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8')); return value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : undefined; } catch { return undefined; }
}

export async function productFeedbackRoutes(req: IncomingMessage, url: URL, deps: LoopDeps, client: string, now = new Date()): Promise<Answer | undefined> {
  if (!url.pathname.startsWith('/product-feedback/')) return undefined;
  if (!enabled()) return answer(404,{error:'unavailable'});
  const store = new FeedbackStore(deps.store.raw);
  const worker = /^\/product-feedback\/worker\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (worker) {
    const secret=process.env['PRODUCT_FEEDBACK_WORKER_TOKEN'] ?? '';
    if (secret.length<32 || !equal(req.headers.authorization ?? '',`Bearer ${secret}`)) return answer(401,{error:'unauthorized'});
    const report = await store.read(worker[1]!,now);
    if (!report) return answer(410,{error:'gone'});
    if (req.method==='GET') return report.issue ? answer(200,report) : answer(409,{error:'ticket_pending'});
    if (req.method!=='POST') return answer(405,{error:'method_not_allowed'});
    const input=await read(req,2048);
    const state=input?.['state']; const issue=input?.['issue']; const pr=input?.['pr'];
    // A build/review worker cannot claim a production release. Only the release
    // reconciler below may promote a ready report after the merged code is running.
    if (typeof state!=='string' || !STATES.includes(state as FeedbackState) || state==='released' || !Number.isSafeInteger(issue)
      || (pr!==undefined && (!Number.isSafeInteger(pr) || Number(pr)<1))) return answer(400,{error:'invalid_update'});
    return answer(await store.status(report.id,state as FeedbackState,Number(issue),pr===undefined?undefined:Number(pr)) ? 200:409,{ok:true});
  }
  if (crossSite(req)) return answer(403,{error:'try_again'});
  let session=cookieOf(req,FEEDBACK_COOKIE);
  if (req.method==='GET' && url.pathname==='/product-feedback/session') {
    const headers:Record<string,string>={};
    if (!validSession(session,now)) {
      session=newSession(now);
      headers['set-cookie']=`${FEEDBACK_COOKIE}=${session}; Path=/product-feedback; Max-Age=${RETENTION_MS/1000}; HttpOnly; SameSite=Strict${config.link.publicUrl().startsWith('https:')?'; Secure':''}`;
    }
    return answer(200,{csrf:csrfFor(session!),reports:await store.list(session!,now)},headers);
  }
  if (req.method!=='POST') return answer(405,{error:'method_not_allowed'});
  if (!validSession(session,now) || !equal(String(req.headers['x-feedback-csrf'] ?? ''),csrfFor(session))) return answer(403,{error:'try_again'});
  if (!String(req.headers['content-type']).startsWith('application/json')) return answer(415,{error:'invalid_format'});
  const input=await read(req);
  if (!input) return answer(413,{error:'invalid_or_large_request'});
  if (url.pathname==='/product-feedback/reports') {
    if (typeof input['requestId']!=='string' || !/^[a-f0-9-]{36}$/.test(input['requestId'])) return answer(400,{error:'invalid_request'});
    const report=readInput(input,runningRelease);
    if (!report) return answer(400,{error:'check_comment_or_image'});
    const browser=cookieOf(req,BROWSER);
    const owner=browser ? await new Links(deps.store.raw).open(browser,now,'browser') : undefined;
    try {
      const id=await store.save(session,clientBucket(client,now),input['requestId'],report,owner?.ok?owner.claims.phoneHash:undefined,now);
      return answer(201,{id});
    } catch(error) {
      if(error instanceof FeedbackLimit) return answer(429,{error:'please_try_later'});
      if(error instanceof FeedbackConflict) return answer(409,{error:'retry_conflict'});
      throw error;
    }
  }
  if (url.pathname==='/product-feedback/delete' && typeof input['id']==='string') {
    await store.remove(session,input['id']); return answer(200,{ok:true});
  }
  if (url.pathname==='/product-feedback/improved' && typeof input['id']==='string' && typeof input['improved']==='boolean') {
    return answer(await store.vote(session,input['id'],input['improved']) ? 200:409,{ok:true});
  }
  return answer(404,{error:'not_found'});
}
