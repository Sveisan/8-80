import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { controlPlane } from '../src/control.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { FeedbackConflict, FeedbackLimit, FeedbackStore } from '../src/product-feedback/store.ts';
import { newSession, validSession, readInput, safePage, ticket, RETENTION_MS } from '../src/product-feedback/model.ts';
import { syncFeedbackIssues } from '../src/product-feedback/github.ts';
import { reconcileReleased } from '../src/product-feedback/reconcile.ts';
import { feedbackWidget } from '../src/product-feedback/widget.ts';
import { composeExport } from '../src/legal/export.ts';
import { loadScript } from '../src/script.ts';
import { phoneKey } from '../src/store/postgres.ts';

const opened=await openTestDb('product_feedback');
const db=typeof opened==='string'?undefined:opened;
const options={skip:typeof opened==='string'?opened:false};
const now=new Date(), input={comment:'The schedule is hard to find.',page:'/me',viewport:'390x844',release:''};
beforeEach(async()=>{
  Object.assign(process.env,{DATA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),PRODUCT_FEEDBACK_ENABLED:'1',PRODUCT_FEEDBACK_WORKER_TOKEN:'synthetic-worker-secret-'.repeat(3)});
  if(db)await db.sql`truncate jev_quality_reviews,product_feedback,callers cascade`;
});
after(async()=>{await db?.close();});
const save=async(session=newSession(),bucket='synthetic',owner?:string):Promise<string>=>new FeedbackStore(db!.sql).save(session,bucket,randomUUID(),input,owner);

test('sessions expire, tampering fails, routes remove credentials and images require a real supported header',()=>{
  const session=newSession(now);assert.ok(validSession(session,now));assert.ok(!validSession(`${session}a`,now));
  assert.ok(!validSession(session,new Date(+now+RETENTION_MS)));
  assert.equal(safePage('/r/private-link?token=secret'),'/me');assert.equal(safePage('/unblock/private/credential'),'/unblock');assert.equal(safePage('/unrecognised/private'),'other');
  assert.equal(readInput({...input,comment:' '}),undefined);assert.equal(readInput({...input,image:{type:'image/png',data:Buffer.from('<script>bad</script>').toString('base64')}}),undefined);
  assert.ok(!ticket(randomUUID()).body.includes(input.comment));
  process.env['PRODUCT_FEEDBACK_ENABLED']='0';assert.equal(feedbackWidget(),'');
});
test('parallel retries save once, differing retry content is refused, encryption and ownership survive',options,async()=>{
  const store=new FeedbackStore(db!.sql),session=newSession(),requestId=randomUUID();
  const ids=await Promise.all(Array.from({length:6},()=>store.save(session,'one',requestId,input)));
  assert.equal(new Set(ids).size,1);assert.equal((await db!.sql`select * from product_feedback`).length,1);
  const [row]=await db!.sql`select payload_enc from product_feedback`;assert.ok(!String(row!['payload_enc']).includes(input.comment));
  assert.equal((await store.list(session))[0]!.comment,input.comment);assert.equal((await store.list(newSession())).length,0);
  await assert.rejects(store.save(session,'one',requestId,{...input,comment:'A different note'}),FeedbackConflict);
  await store.remove(newSession(),ids[0]!);assert.equal((await store.list(session)).length,1);
  await store.remove(session,ids[0]!);assert.equal((await store.list(session)).length,0);
});
test('a browser reset does not bypass the shared daily submission limit',options,async()=>{
  await Promise.all(Array.from({length:10},()=>save()));await assert.rejects(save(),FeedbackLimit);
});
test('authenticated feedback is included in export, cascades with account deletion, and expires',options,async()=>{
  const phone='+4798112200';await db!.store.upsertProfile(phone,{name:'Synthetic'});
  await save(newSession(),'one',phoneKey(phone));
  assert.ok((await composeExport(db!.store,phone,loadScript()))!.body.includes(input.comment));
  await db!.store.forget(phone);assert.equal((await db!.sql`select * from product_feedback`).length,0);
  await save();assert.equal(await new FeedbackStore(db!.sql).prune(new Date(+now+RETENTION_MS+10000)),1);
});
test('private tracker verification precedes writes; lost issue responses reconcile without duplicates',options,async()=>{
  const id=await save();const settings={repository:'example/private',token:'synthetic'};let posts=0;
  const publicRepo=(async()=>new Response(JSON.stringify({private:false}))) as typeof fetch;
  await assert.rejects(syncFeedbackIssues(db!.sql,settings,publicRepo),/private repository/);
  let body='';
  const transport=(async(url,init)=>{
    if(init?.method==='POST'){posts++;body=String(init.body);throw Error('response lost after remote acceptance');}
    // A concurrent reconciler cannot find the remote issue before POST accepts it.
    if(String(url).includes('/issues?'))return new Response(JSON.stringify(posts?[{number:11,body:ticket(id).body}]:[]));
    return new Response(JSON.stringify({private:true}));
  }) as typeof fetch;
  await Promise.all([syncFeedbackIssues(db!.sql,settings,transport),syncFeedbackIssues(db!.sql,settings,transport)]);
  assert.equal(posts,1);assert.ok(!body.includes(input.comment));
  await db!.sql`update product_feedback set issue_attempted_at=now()-interval '6 minutes'`;
  await syncFeedbackIssues(db!.sql,settings,transport);assert.equal(posts,1);
  assert.equal((await db!.sql`select issue_number from product_feedback`)[0]!['issue_number'],11);
});
test('HTTP requires browser proof and CSRF, rejects oversized input, keeps worker updates separate',options,async()=>{
  const server=controlPlane({store:db!.store} as LoopDeps,'synthetic');await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env['PUBLIC_URL']=origin;
  const request=(path:string,init?:RequestInit)=>fetch(`${origin}/product-feedback/${path}`,init);
  try {
    const response=await request('session');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const cookie=response.headers.get('set-cookie')!.split(';')[0]!,session=await response.json() as {csrf:string};
    const headers={'content-type':'application/json',cookie,'x-feedback-csrf':session.csrf};
    const payload={...input,requestId:randomUUID(),page:'/r/secret?token=private'};
    assert.equal((await request('reports',{method:'POST',headers:{...headers,'sec-fetch-site':'cross-site'},body:JSON.stringify(payload)})).status,403);
    assert.equal((await request('reports',{method:'POST',headers:{...headers,'x-feedback-csrf':'wrong'},body:JSON.stringify(payload)})).status,403);
    assert.equal((await request('reports',{method:'POST',headers,body:JSON.stringify({...payload,comment:'a'.repeat(1500000)})})).status,413);
    const created=await request('reports',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(created.status,201);const {id}=await created.json() as {id:string};
    assert.equal((await new FeedbackStore(db!.sql).read(id))!.input.page,'/me');
    assert.equal((await request(`worker/${id}`)).status,401);
    const workerHeaders={authorization:`Bearer ${process.env['PRODUCT_FEEDBACK_WORKER_TOKEN']}`,'content-type':'application/json'};
    await db!.sql`update product_feedback set issue_number=9 where id=${id}`;
    assert.equal((await request(`worker/${id}`,{headers:workerHeaders})).status,200);
    const update=(state:string,issue=9)=>request(`worker/${id}`,{method:'POST',headers:workerHeaders,body:JSON.stringify({state,issue,pr:12})});
    assert.equal((await update('released')).status,400);assert.equal((await update('reviewing',8)).status,409);
    assert.equal((await update('reviewing')).status,200);assert.equal((await update('ready')).status,200);
    assert.equal((await update('ready')).status,200);assert.equal((await update('reviewing')).status,409);
    assert.equal((await request('improved',{method:'POST',headers,body:JSON.stringify({id,improved:true})})).status,409);
    process.env['PRODUCT_FEEDBACK_ENABLED']='0';assert.equal((await request('session')).status,404);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('merged alone is insufficient; only an ancestor of the verified live release enables outcome feedback',options,async()=>{
  const session=newSession(),id=await save(session);await db!.sql`update product_feedback set state='ready',pr_number=12 where id=${id}`;
  const mergedSHA='a'.repeat(40),liveSHA='b'.repeat(40);
  const transport=(async()=>new Response(JSON.stringify({merged:true,merge_commit_sha:mergedSHA,head:{ref:`codex/feedback-${id}`},body:`<!-- product-feedback:${id} -->`}))) as typeof fetch;
  assert.equal(await reconcileReleased(db!.sql,liveSHA,()=>false,transport),0);
  assert.equal(await reconcileReleased(db!.sql,liveSHA,(sha,head)=>sha===mergedSHA&&head===liveSHA,transport),1);
  assert.equal(await new FeedbackStore(db!.sql).vote(newSession(),id,true),false);
  assert.equal(await new FeedbackStore(db!.sql).vote(session,id,true),true);
});
