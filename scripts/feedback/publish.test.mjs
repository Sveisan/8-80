import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/* global Response, URL */

test('a lost branch response reconciles once, publishes only screened code, and never merges or deploys',async()=>{
  const original=process.cwd(),oldFetch=globalThis.fetch,oldEnv={...process.env},oldExit=process.exitCode;
  const cwd=mkdtempSync(join(tmpdir(),'8and80-publish-'));
  const ui='services/voice/src/signup/page.ts',regression='services/voice/test/feedback-regression-1234abcd.test.ts';
  const id='12345678-1234-4234-8234-123456789abc',base='a'.repeat(40),candidate='b'.repeat(40),branch=`codex/feedback-${id}`;
  const secretComment='This private customer sentence must not be published in any GitHub write.';
  const request={id,issue:2,base,branch:'main',input:{comment:secretComment}};
  const patch=`diff --git a/${ui} b/${ui}\n--- a/${ui}\n+++ b/${ui}\n@@ -1 +1 @@\n-old\n+improved\ndiff --git a/${regression} b/${regression}\nnew file mode 100644\n--- /dev/null\n+++ b/${regression}\n@@ -0,0 +1 @@\n+synthetic\n`;
  const writes=[],states=[];let ref=false,pr,loseResponse=true,altered=false;
  const git=(...args)=>execFileSync('git',args,{cwd,stdio:'pipe'});
  const restore=()=>{git('reset','--hard','HEAD');rmSync(join(cwd,regression),{force:true});mkdirSync(join(cwd,'.feedback-private'),{recursive:true});writeFileSync(join(cwd,'.feedback-private/request.json'),JSON.stringify(request));};
  try {
    mkdirSync(join(cwd,'services/voice/src/signup'),{recursive:true});mkdirSync(join(cwd,'services/voice/test'),{recursive:true});writeFileSync(join(cwd,ui),'old\n');
    git('init','-q');git('add','.');git('-c','user.name=Synthetic','-c','user.email=synthetic@example.com','commit','-qm','Fixture');process.chdir(cwd);
    Object.assign(process.env,{FEEDBACK_RESULT:JSON.stringify({status:'ready',summary:'Synthetic improvement',patch}),FEEDBACK_REVIEW:'{"approved":true}',
      FEEDBACK_CODE_TOKEN:'synthetic',GITHUB_TOKEN:'synthetic',GITHUB_REPOSITORY:'example/private',FEEDBACK_SERVICE_URL:'https://feedback.invalid',FEEDBACK_WORKER_TOKEN:'synthetic'});
    globalThis.fetch=async(url,init={})=>{
      const parsed=new URL(url),path=parsed.pathname,method=init.method??'GET',body=init.body?JSON.parse(init.body):undefined;
      const reply=value=>new Response(JSON.stringify(value));
      if(parsed.hostname==='feedback.invalid'){states.push(body);return reply({ok:true});}
      if(method!=='GET')writes.push({path,method,body});
      if(path==='/repos/example/private')return reply({private:true});
      if(path.endsWith('/pulls')&&method==='GET')return reply(pr?[pr]:[]);
      if(path.endsWith(`/git/commits/${base}`))return reply({tree:{sha:'base-tree'}});
      if(path.endsWith(`/git/commits/${candidate}`))return reply({tree:{sha:altered?'changed-by-person':'next-tree'},parents:[{sha:base}]});
      if(path.endsWith('/git/blobs'))return reply({sha:'blob'});
      if(path.endsWith('/git/trees'))return reply({sha:'next-tree'});
      if(path.endsWith('/git/commits')&&method==='POST')return reply({sha:candidate});
      if(path.includes('/git/matching-refs/'))return reply(ref?[{ref:`refs/heads/${branch}`,object:{sha:candidate}}]:[]);
      if(path.endsWith('/git/refs')){ref=true;if(loseResponse){loseResponse=false;throw Error('Remote accepted the branch; response was lost');}return reply({});}
      if(path.endsWith('/pulls')&&method==='POST'){pr={number:10,state:'open',head:{ref:branch,sha:candidate,repo:{full_name:'Sveisan/8-80'}},base:{ref:'main'},html_url:'https://github.com/Sveisan/8-80/pull/10'};return reply(pr);}
      if(path.endsWith('/comments'))return reply({});
      throw Error('Unexpected operation');
    };
    restore();await import(`./publish.mjs?first=${Date.now()}`);assert.equal(process.exitCode,1);assert.equal(states.length,0);
    process.exitCode=undefined;restore();await import(`./publish.mjs?retry=${Date.now()}`);assert.equal(process.exitCode,undefined);
    assert.deepEqual(states,[{state:'ready',issue:2,pr:10}]);
    assert.equal(writes.filter(x=>x.path.endsWith('/git/refs')).length,1);assert.equal(writes.filter(x=>x.path.endsWith('/pulls')).length,1);
    assert.ok(!JSON.stringify(writes).includes(secretComment));assert.ok(!writes.some(x=>/merge|deployment/.test(x.path)||x.method==='PATCH'));
    // A person's subsequent edits must not be overwritten or silently declared validated.
    altered=true;restore();await import(`./publish.mjs?edited=${Date.now()}`);assert.equal(process.exitCode,1);assert.equal(states.length,1);
  } finally {process.chdir(original);globalThis.fetch=oldFetch;process.env=oldEnv;process.exitCode=oldExit;rmSync(cwd,{recursive:true,force:true});}
});
